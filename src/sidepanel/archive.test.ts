// @vitest-environment jsdom
// Node has no IndexedDB, so this shims the globals before archive-db loads.
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addArchiveEntry, closeArchiveDb, countArchiveEntries } from '../shared/archive-db';
import { initArchiveSearch, renderArchive } from './archive';

const createTab = vi.fn();
const updateTab = vi.fn();
const updateWindow = vi.fn();

/** Tabs the browser is pretending to have open. */
let openTabs: Array<Partial<chrome.tabs.Tab>> = [];
const queryTabs = vi.fn(async () => openTabs);

vi.stubGlobal('chrome', {
  tabs: {
    create: createTab,
    update: updateTab,
    query: queryTabs,
  },
  windows: { update: updateWindow },
});

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
  updateTab.mockReset();
  updateWindow.mockReset();
  openTabs = [];
  queryTabs.mockReset();
  queryTabs.mockImplementation(async () => openTabs);
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

describe('loading', () => {
  it('says it is loading while there is nothing on screen yet', async () => {
    await addArchiveEntry({
      url: 'https://example.com/a',
      title: 'A',
      hasFullText: true,
      extractedText: 'body text',
    });
    const container = document.createElement('ul');
    document.body.appendChild(container);

    // Deliberately not awaited: the point is what the panel shows *during* the
    // read, which is the whole reason this state exists.
    const pending = renderArchive(container);
    expect(container.querySelector('.loading-state')).not.toBeNull();

    await pending;
    await flush();

    expect(container.querySelector('.loading-state')).toBeNull();
    expect(titlesIn(container)).toEqual(['A']);
  });

  it('keeps the rows up while re-reading, rather than blinking them away', async () => {
    // Re-entering the Archive tab re-renders a list that is already correct.
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    const pending = renderArchive(container);

    expect(container.querySelector('.loading-state')).toBeNull();
    expect(titlesIn(container)).toEqual(['A']);
    await pending;
  });

  it('leaves an empty archive reading as empty, not as loading', async () => {
    const { container } = await mount([]);
    await flush();

    const pending = renderArchive(container);

    expect(container.querySelector('.loading-state')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toBeNull();
    await pending;
  });
});

describe('entries whose page is open', () => {
  const badgesOn = (row: HTMLElement) =>
    Array.from(row.querySelectorAll('.row-badge')).map((badge) => badge.textContent);

  it('marks an entry that is also open right now', async () => {
    // Restoring doesn't remove the entry, so the same page can be in the
    // archive and on screen at once. The row has to say so.
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/a' }];

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    expect(badgesOn(rowByTitle(container, 'A'))).toContain('open');
  });

  it('leaves a closed page unmarked', async () => {
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    expect(badgesOn(rowByTitle(container, 'A'))).not.toContain('open');
  });

  it('marks only the entries that match', async () => {
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/a' }];

    const { container } = await mount([
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/b', title: 'B' },
    ]);
    await flush();

    expect(badgesOn(rowByTitle(container, 'A'))).toContain('open');
    expect(badgesOn(rowByTitle(container, 'B'))).not.toContain('open');
  });

  it('does not match a different page on the same site', async () => {
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/other' }];

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    expect(badgesOn(rowByTitle(container, 'A'))).not.toContain('open');
  });

  it('keeps the metadata-only badge alongside it', async () => {
    // Both facts are true at once, and one silently winning would hide the
    // other.
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/a' }];
    await addArchiveEntry({ url: 'https://example.com/a', title: 'A', hasFullText: false });

    const container = document.createElement('ul');
    const input = document.createElement('input');
    document.body.append(container, input);
    initArchiveSearch(input, container);
    await renderArchive(container);
    await flush();

    expect(badgesOn(rowByTitle(container, 'A'))).toEqual(['metadata only', 'open']);
  });

  it('offers to switch rather than restore', async () => {
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/a' }];

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    const labels = Array.from(rowByTitle(container, 'A').querySelectorAll('button')).map(
      (button) => button.textContent,
    );
    expect(labels).toContain('Switch to tab');
    expect(labels).not.toContain('Restore');
  });

  it('switches to the existing tab instead of opening a second copy', async () => {
    openTabs = [{ id: 5, windowId: 3, url: 'https://example.com/a' }];

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    clickButton(rowByTitle(container, 'A'), 'Switch to tab');
    await flush();

    expect(updateTab).toHaveBeenCalledWith(5, { active: true });
    expect(createTab).not.toHaveBeenCalled();
  });

  it('focuses the window too, so a background window is not silently ignored', async () => {
    openTabs = [{ id: 5, windowId: 3, url: 'https://example.com/a' }];

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    clickButton(rowByTitle(container, 'A'), 'Switch to tab');
    await flush();

    expect(updateWindow).toHaveBeenCalledWith(3, { focused: true });
  });

  it('opens a tab when the page was closed after the row was drawn', async () => {
    // The row said "Switch to tab", then the tab went away. Creating one is
    // the recoverable outcome, so the click re-checks rather than trusting
    // the snapshot it was rendered from.
    openTabs = [{ id: 5, windowId: 1, url: 'https://example.com/a' }];
    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    openTabs = [];
    clickButton(rowByTitle(container, 'A'), 'Switch to tab');
    await flush();

    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.com/a' });
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('still shows the archive when the tabs cannot be read', async () => {
    // The marker is worth losing; the view is not.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryTabs.mockRejectedValue(new Error('no tabs permission'));

    const { container } = await mount([{ url: 'https://example.com/a', title: 'A' }]);
    await flush();

    expect(titlesIn(container)).toEqual(['A']);
    expect(rowByTitle(container, 'A').querySelectorAll('.row-badge')).toHaveLength(0);
  });
});
