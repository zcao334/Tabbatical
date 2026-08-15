import { deleteArchiveEntry, getAllArchiveEntries } from '../shared/archive-db';
import { createArchiveSearcher, type ArchiveSearcher, type SearchHit } from '../shared/archive-search';
import type { ArchiveEntry } from '../shared/types';
import {
  createEntryRow,
  createRenderGuard,
  createRowState,
  renderEmptyState,
} from './components';

const renderGuard = createRenderGuard();

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Recent captures get a relative label because "2h ago" is what the user is
 * actually reasoning about when reviewing today's archiving; older ones get a
 * date, since "43 days ago" is harder to place than "Jul 2".
 */
export function formatArchivedAt(archivedAt: number, now: number = Date.now()): string {
  const elapsed = now - archivedAt;

  // Clock skew or an entry written a moment ago shouldn't read "in -1 minutes".
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  if (elapsed < 7 * MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
  return DATE_FORMAT.format(archivedAt);
}

/**
 * Loaded entries and their index, kept between renders.
 *
 * Searching has to be synchronous to filter as the user types, so the archive
 * is read from IndexedDB once and re-queried in memory. Reloading per keystroke
 * would also rebuild the Fuse index each time.
 */
let entries: ArchiveEntry[] = [];
let searcher: ArchiveSearcher | null = null;
let searchInput: HTMLInputElement | null = null;

/** Tracks which rows have a restore or delete in flight, and which last failed. */
const rowState = createRowState<string>();

/**
 * The entry whose Delete button is armed, if any.
 *
 * Deleting discards captured text that can't be recovered by re-archiving —
 * the page may be gone, paywalled, or simply different — so a single stray
 * click shouldn't do it. Arming one row at a time keeps this to a single id
 * and needs no timers: clicking Delete elsewhere just moves the confirmation.
 */
let armedDeleteId: string | null = null;

/** Wires the search box; the archive re-filters in place as the query changes. */
export function initArchiveSearch(input: HTMLInputElement, container: HTMLElement): void {
  searchInput = input;
  input.addEventListener('input', () => {
    // Rows move as the query narrows, so an armed Delete shouldn't outlive the
    // list it was aimed at.
    armedDeleteId = null;
    renderHits(container);
  });
}

/** Reopens an archived page. The entry stays put — Delete is the way to remove it. */
async function restoreEntry(entry: ArchiveEntry, container: HTMLElement): Promise<void> {
  armedDeleteId = null;
  await rowState.run(
    entry.id,
    async () => {
      await chrome.tabs.create({ url: entry.url });
    },
    { errorMessage: "Couldn't reopen this page", render: () => renderHits(container) },
  );
}

async function deleteEntry(entry: ArchiveEntry, container: HTMLElement): Promise<void> {
  if (armedDeleteId !== entry.id) {
    armedDeleteId = entry.id;
    renderHits(container);
    return;
  }

  armedDeleteId = null;
  await rowState.run(
    entry.id,
    async () => {
      await deleteArchiveEntry(entry.id);
      // Dropped from the cache rather than reloaded: re-reading the archive
      // would pull every entry's full text back out of IndexedDB to learn one
      // row is gone.
      setEntries(entries.filter((candidate) => candidate.id !== entry.id));
    },
    { errorMessage: "Couldn't delete this entry", render: () => renderHits(container) },
  );
}

function buildRow(hit: SearchHit, container: HTMLElement): HTMLLIElement {
  const { entry } = hit;
  const busy = rowState.isPending(entry.id);
  const armed = armedDeleteId === entry.id;

  const row = createEntryRow({
    title: entry.title,
    // Source lives in the hover text instead of the row: the favicon and title
    // already say which site this is, and at panel width the domain crowded out
    // the capture time, which appears nowhere else on screen.
    meta: formatArchivedAt(entry.archivedAt),
    faviconUrl: entry.faviconUrl,
    // Surfaces what Week 2 could only show in DevTools: whether this entry
    // holds readable text or just the metadata of a page we couldn't read.
    badge: entry.hasFullText ? undefined : 'metadata only',
    snippet: hit.snippet,
    error: rowState.errorFor(entry.id),
    actions: [
      {
        label: 'Restore',
        disabled: busy,
        onClick: () => void restoreEntry(entry, container),
      },
      {
        label: armed ? 'Delete?' : 'Delete',
        className: armed ? 'row-button row-button--danger' : undefined,
        disabled: busy,
        onClick: () => void deleteEntry(entry, container),
      },
    ],
  });

  // The full URL, not just the domain — a tooltip has room for it, and it's
  // what distinguishes two captures of the same site. The exact capture time
  // comes along since the row itself only shows "1d ago".
  row.title = `${entry.url}\nArchived ${DATE_TIME_FORMAT.format(entry.archivedAt)}`;
  return row;
}

function currentQuery(): string {
  return searchInput?.value ?? '';
}

function renderHits(container: HTMLElement): void {
  if (!searcher) return;

  const query = currentQuery();
  const hits = searcher.search(query);

  if (hits.length === 0) {
    // Distinguishes "the archive is empty" from "nothing matched", which look
    // identical otherwise and suggest very different next steps.
    renderEmptyState(
      container,
      entries.length === 0
        ? 'Nothing archived yet. Archive a tab to see it here.'
        : `No archived pages match “${query}”.`,
    );
    return;
  }

  container.innerHTML = '';
  for (const hit of hits) {
    container.appendChild(buildRow(hit, container));
  }
}

/** Swaps in a new entry list and reindexes it for search. */
function setEntries(next: ArchiveEntry[]): void {
  entries = next;
  searcher = createArchiveSearcher(next);
}

export async function renderArchive(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();

  let loaded: ArchiveEntry[];
  try {
    loaded = await getAllArchiveEntries();
  } catch (error) {
    console.error('[Tabbatical] Failed to read the archive', error);
    if (isCurrent()) renderEmptyState(container, "Couldn't load the archive.");
    return;
  }

  if (!isCurrent()) return;

  setEntries(loaded);
  renderHits(container);
}
