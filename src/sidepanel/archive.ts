import { getAllArchiveEntries } from '../shared/archive-db';
import { createArchiveSearcher, type ArchiveSearcher, type SearchHit } from '../shared/archive-search';
import type { ArchiveEntry } from '../shared/types';
import { createEntryRow, createRenderGuard, formatDomain, renderEmptyState } from './components';

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

function buildRow(hit: SearchHit): HTMLLIElement {
  const { entry } = hit;
  return createEntryRow({
    title: entry.title,
    // Domain first: it's what identifies a page at a glance once the title
    // is truncated.
    meta: `${formatDomain(entry.url)} · ${formatArchivedAt(entry.archivedAt)}`,
    faviconUrl: entry.faviconUrl,
    // Surfaces what Week 2 could only show in DevTools: whether this entry
    // holds readable text or just the metadata of a page we couldn't read.
    badge: entry.hasFullText ? undefined : 'metadata only',
    snippet: hit.snippet,
  });
}

/**
 * Loaded entries and their index, kept between renders.
 *
 * Searching has to be synchronous to filter as the user types, so the archive
 * is read from IndexedDB once and re-queried in memory. Reloading per keystroke
 * would also rebuild the Fuse index each time.
 */
let searcher: ArchiveSearcher | null = null;
let entryCount = 0;
let searchInput: HTMLInputElement | null = null;

/** Wires the search box; the archive re-filters in place as the query changes. */
export function initArchiveSearch(input: HTMLInputElement, container: HTMLElement): void {
  searchInput = input;
  input.addEventListener('input', () => renderHits(container));
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
      entryCount === 0
        ? 'Nothing archived yet. Archive a tab to see it here.'
        : `No archived pages match “${query}”.`,
    );
    return;
  }

  container.innerHTML = '';
  for (const hit of hits) {
    const row = buildRow(hit);
    // Exact capture time on hover; the row itself stays compact.
    row.title = DATE_TIME_FORMAT.format(hit.entry.archivedAt);
    container.appendChild(row);
  }
}

export async function renderArchive(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();

  let entries: ArchiveEntry[];
  try {
    entries = await getAllArchiveEntries();
  } catch (error) {
    console.error('[Tabbatical] Failed to read the archive', error);
    if (isCurrent()) renderEmptyState(container, "Couldn't load the archive.");
    return;
  }

  if (!isCurrent()) return;

  searcher = createArchiveSearcher(entries);
  entryCount = entries.length;
  renderHits(container);
}
