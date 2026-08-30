import { deleteArchiveEntry, getAllArchiveEntries } from '../shared/archive-db';
import { createArchiveSearcher, type ArchiveSearcher, type SearchHit } from '../shared/archive-search';
import type { ArchiveEntry } from '../shared/types';
import {
  createArmedRow,
  createEntryRow,
  createRenderGuard,
  createRowState,
  renderEmptyState,
  renderLoadingState,
} from './components';
import { getOpenTabsByUrl, openOrFocusTab } from '../shared/tabs';
import { DATE_TIME_FORMAT, formatArchivedAt } from './time';

const renderGuard = createRenderGuard();

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

/**
 * Open tabs by URL, as of the last render.
 *
 * An archived page can also be open — restoring one doesn't remove it, since
 * the capture may be the only surviving copy of a page that has changed or
 * gone. That makes "this is also open right now" a fact the row has to state,
 * or the archive quietly misrepresents itself.
 */
let openTabsByUrl = new Map<string, chrome.tabs.Tab>();

/** Tracks which rows have a restore or delete in flight, and which last failed. */
const rowState = createRowState<string>();

/**
 * The entry whose Delete button is armed, if any.
 *
 * Deleting discards captured text that can't be recovered by re-archiving —
 * the page may be gone, paywalled, or simply different — so a single stray
 * click shouldn't do it. Arming one row at a time needs no timers: clicking
 * Delete elsewhere just moves the confirmation.
 */
const armedDelete = createArmedRow<string>();

/** Wires the search box; the archive re-filters in place as the query changes. */
export function initArchiveSearch(input: HTMLInputElement, container: HTMLElement): void {
  searchInput = input;
  input.addEventListener('input', () => {
    // Rows move as the query narrows, so an armed Delete shouldn't outlive the
    // list it was aimed at.
    armedDelete.clear();
    renderHits(container);
  });
}

/**
 * Opens an archived page. The entry stays put — Delete is the way to remove it.
 *
 * Switches to the page when it's already open rather than opening a second
 * copy of it. Once a row says "open", a button that duplicates the tab is
 * contradicting the row right next to it.
 */
async function restoreEntry(entry: ArchiveEntry, container: HTMLElement): Promise<void> {
  armedDelete.clear();
  await rowState.run(
    entry.id,
    // Re-checks rather than trusting the render's snapshot: the tab may have
    // been closed in the time the row sat on screen.
    () => openOrFocusTab(entry.url),
    { errorMessage: "Couldn't reopen this page", render: () => renderHits(container) },
  );
}

async function deleteEntry(entry: ArchiveEntry, container: HTMLElement): Promise<void> {
  if (!armedDelete.isArmed(entry.id)) {
    armedDelete.arm(entry.id);
    renderHits(container);
    return;
  }

  armedDelete.clear();
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
  const armed = armedDelete.isArmed(entry.id);

  const isOpen = openTabsByUrl.has(entry.url);

  const row = createEntryRow({
    title: entry.title,
    // Source lives in the hover text instead of the row: the favicon and title
    // already say which site this is, and at panel width the domain crowded out
    // the capture time, which appears nowhere else on screen.
    meta: formatArchivedAt(entry.archivedAt),
    faviconUrl: entry.faviconUrl,
    badge: [
      // Surfaces what Week 2 could only show in DevTools: whether this entry
      // holds readable text or just the metadata of a page we couldn't read.
      ...(entry.hasFullText ? [] : ['metadata only']),
      ...(isOpen ? ['open'] : []),
    ],
    snippet: hit.snippet,
    error: rowState.errorFor(entry.id),
    actions: [
      {
        // The label is the honest description of what the click does, which
        // is also how the user learns this won't leave them with two copies.
        label: isOpen ? 'Switch to tab' : 'Restore',
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

  // This is the one view whose load is worth announcing: it reads every
  // entry's full text out of IndexedDB and builds a search index over it,
  // where the other views read one small object out of chrome.storage.
  //
  // Only when there is nothing on screen to keep, though. Re-entering the view
  // leaves the previous rows up while the reread happens, and replacing them
  // with "Loading…" for a frame reads as a glitch rather than as progress.
  if (container.childElementCount === 0) renderLoadingState(container, 'Loading your archive…');

  // Read alongside the archive rather than per row: one tabs.query for the
  // whole render instead of one per entry.
  openTabsByUrl = await getOpenTabsByUrl();

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
