// @vitest-environment jsdom
// Node has no IndexedDB, so this shims the globals before archive-db loads.
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addArchiveEntry, closeArchiveDb, countArchiveEntries } from '../shared/archive-db';
import { formatArchivedAt, initArchiveSearch, renderArchive } from './archive';

const NOW = new Date('2026-08-14T12:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatArchivedAt', () => {
  it('labels the last minute as just now', () => {
    expect(formatArchivedAt(NOW, NOW)).toBe('just now');
    expect(formatArchivedAt(NOW - 59_000, NOW)).toBe('just now');
  });

  it('never reads as negative when the timestamp is slightly ahead', () => {
    // Clock skew between the service worker's write and the panel's read.
    expect(formatArchivedAt(NOW + 5_000, NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatArchivedAt(NOW - 5 * MINUTE, NOW)).toBe('5m ago');
    expect(formatArchivedAt(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(formatArchivedAt(NOW - 2 * DAY, NOW)).toBe('2d ago');
  });

  it('switches to a date once relative time stops being readable', () => {
    // A week out, "43d ago" is harder to place than a calendar date.
    const old = formatArchivedAt(NOW - 30 * DAY, NOW);
    expect(old).not.toMatch(/ago|just now/);
  });

  it('does not skip a unit at the boundaries', () => {
    expect(formatArchivedAt(NOW - MINUTE, NOW)).toBe('1m ago');
    expect(formatArchivedAt(NOW - HOUR, NOW)).toBe('1h ago');
    expect(formatArchivedAt(NOW - DAY, NOW)).toBe('1d ago');
  });
});

const createTab = vi.fn();
vi.stubGlobal('chrome', { tabs: { create: createTab } });

/** Lets queued handlers, renders and IndexedDB callbacks settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(seed: Array<{ url: string; title: string }>) {
  for (const entry of seed) {
    await addArchiveEntry({ ...entry, hasFullText: true, extractedText: 'body text' });
  }

  const container = document.createElement('ul');
  const input = document.createElement('input');
  document.body.append(container, input);

  initArchiveSearch(input, container);
  await renderArchive(container);
  return { container, input };
}

const rowsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLLIElement>('.entry-row'));

/** Rows render newest-first, so position is a poor way to name one. */
function rowByTitle(container: HTMLElement, title: string): HTMLLIElement {
  const row = rowsIn(container).find((candidate) =>
    candidate.querySelector('.row-title')?.textContent === title,
  );
  if (!row) throw new Error(`No row titled "${title}"`);
  return row;
}

const titlesIn = (container: HTMLElement) =>
  rowsIn(container).map((row) => row.querySelector('.row-title')?.textContent);

function clickButton(row: HTMLElement, label: string): void {
  const button = Array.from(row.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No "${label}" button on the row`);
  button.dispatchEvent(new Event('click'));
}

beforeEach(() => {
  createTab.mockReset();
  document.body.innerHTML = '';
});

afterEach(async () => {
  await closeArchiveDb();
  await deleteDB('tab-review-archive');
});

describe('restore', () => {
  it('reopens the archived URL in a new tab', async () => {
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);

    clickButton(rowsIn(container)[0], 'Restore');
    await flush();

    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.com/a' });
  });

  it('leaves the entry in the archive', async () => {
    // Restoring is not a move: Delete is the only thing that removes an entry.
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);

    clickButton(rowsIn(container)[0], 'Restore');
    await flush();

    expect(await countArchiveEntries()).toBe(1);
    expect(rowsIn(container)).toHaveLength(1);
  });

  it('reports a failure on the row instead of failing silently', async () => {
    // chrome:// pages reopen fine — tabs.create allows them, unlike tabs.update.
    // This covers the schemes the browser does refuse, and URLs stored from a
    // page that has since become unopenable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createTab.mockRejectedValueOnce(new Error('Invalid url'));
    const { container } = await mount([{ url: 'javascript:void 0', title: 'Odd page' }]);

    clickButton(rowsIn(container)[0], 'Restore');
    await flush();

    expect(container.querySelector('.row-error')?.textContent).toBe("Couldn't reopen this page");
    expect(await countArchiveEntries()).toBe(1);
  });
});

describe('delete', () => {
  it('does not delete on the first click', async () => {
    // The captured text is unrecoverable, so one stray click must not spend it.
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);

    clickButton(rowsIn(container)[0], 'Delete');
    await flush();

    expect(await countArchiveEntries()).toBe(1);
    expect(rowsIn(container)).toHaveLength(1);
  });

  it('arms the row so the second click is the deliberate one', async () => {
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);

    clickButton(rowsIn(container)[0], 'Delete');
    await flush();

    expect(rowsIn(container)[0].querySelector('.row-button--danger')?.textContent).toBe('Delete?');
  });

  it('deletes on the second click', async () => {
    const { container } = await mount([
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/b', title: 'B' },
    ]);

    clickButton(rowByTitle(container, 'B'), 'Delete');
    await flush();
    clickButton(rowByTitle(container, 'B'), 'Delete?');
    await flush();

    expect(await countArchiveEntries()).toBe(1);
    expect(titlesIn(container)).toEqual(['A']);
  });

  it('drops the entry from search as well as the list', async () => {
    const { container, input } = await mount([
      { url: 'https://example.com/a', title: 'Unique Title' },
      { url: 'https://example.com/b', title: 'Other' },
    ]);

    clickButton(rowByTitle(container, 'Unique Title'), 'Delete');
    await flush();
    clickButton(rowByTitle(container, 'Unique Title'), 'Delete?');
    await flush();

    input.value = 'Unique';
    input.dispatchEvent(new Event('input'));
    await flush();

    expect(rowsIn(container)).toHaveLength(0);
    expect(container.textContent).toContain('No archived pages match');
  });

  it('moves the confirmation when another row is armed', async () => {
    // Two rows armed at once would make the next click ambiguous.
    const { container } = await mount([
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/b', title: 'B' },
    ]);

    clickButton(rowByTitle(container, 'A'), 'Delete');
    await flush();
    clickButton(rowByTitle(container, 'B'), 'Delete');
    await flush();

    expect(container.querySelectorAll('.row-button--danger')).toHaveLength(1);
    expect(rowByTitle(container, 'B').querySelector('.row-button--danger')).not.toBeNull();
  });

  it('disarms when the query changes, since the rows move underneath', async () => {
    const { container, input } = await mount([
      { url: 'https://example.com/a', title: 'Alpha' },
      { url: 'https://example.com/b', title: 'Beta' },
    ]);

    clickButton(rowsIn(container)[0], 'Delete');
    await flush();

    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    await flush();

    expect(container.querySelector('.row-button--danger')).toBeNull();
  });

  it('shows the empty state after the last entry goes', async () => {
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);

    clickButton(rowsIn(container)[0], 'Delete');
    await flush();
    clickButton(rowsIn(container)[0], 'Delete?');
    await flush();

    expect(container.textContent).toContain('Nothing archived yet');
  });
});
