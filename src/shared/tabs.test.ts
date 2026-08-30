import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusTab, getOpenTabsByUrl, openOrFocusTab } from './tabs';

let openTabs: Array<Partial<chrome.tabs.Tab>> = [];

const tabsQuery = vi.fn(async (info: { url?: string }) =>
  info.url ? openTabs.filter((tab) => tab.url === info.url) : openTabs,
);
const tabsCreate = vi.fn(async ({ url }: { url: string }) => ({ id: 99, windowId: 5, url }));
const tabsUpdate = vi.fn(async () => ({}));
const windowsUpdate = vi.fn(async () => ({}));

vi.stubGlobal('chrome', {
  tabs: { query: tabsQuery, create: tabsCreate, update: tabsUpdate },
  windows: { update: windowsUpdate },
});

beforeEach(() => {
  vi.clearAllMocks();
  openTabs = [];
  tabsQuery.mockImplementation(async (info: { url?: string }) =>
    info.url ? openTabs.filter((tab) => tab.url === info.url) : openTabs,
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getOpenTabsByUrl', () => {
  it('keys the open tabs by URL', async () => {
    openTabs = [{ id: 1, url: 'https://example.com/a' }];

    expect((await getOpenTabsByUrl()).get('https://example.com/a')?.id).toBe(1);
  });

  it('keeps the first of a duplicated URL rather than the last', async () => {
    openTabs = [
      { id: 1, url: 'https://example.com/a' },
      { id: 2, url: 'https://example.com/a' },
    ];

    expect((await getOpenTabsByUrl()).get('https://example.com/a')?.id).toBe(1);
  });

  it('skips tabs with no URL', async () => {
    openTabs = [{ id: 1 }, { id: 2, url: '  ' }];

    expect((await getOpenTabsByUrl()).size).toBe(0);
  });

  it('degrades to empty rather than throwing', async () => {
    // A failed lookup should cost the caller its marker, not its whole view.
    tabsQuery.mockRejectedValueOnce(new Error('no tabs permission'));

    expect((await getOpenTabsByUrl()).size).toBe(0);
  });
});

describe('openOrFocusTab', () => {
  it('opens the page when nothing has it', async () => {
    await openOrFocusTab('https://example.com/a');

    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/a' });
  });

  it('focuses the existing tab instead of opening a second copy', async () => {
    openTabs = [{ id: 7, windowId: 3, url: 'https://example.com/a' }];

    await openOrFocusTab('https://example.com/a');

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });

  it('focuses the window as well, either way', async () => {
    // A tab activated in a background window is a click that appears to do
    // nothing at all.
    openTabs = [{ id: 7, windowId: 3, url: 'https://example.com/a' }];
    await openOrFocusTab('https://example.com/a');
    expect(windowsUpdate).toHaveBeenCalledWith(3, { focused: true });

    openTabs = [];
    await openOrFocusTab('https://example.com/b');
    expect(windowsUpdate).toHaveBeenCalledWith(5, { focused: true });
  });

  it('does not match a different page on the same site', async () => {
    openTabs = [{ id: 7, windowId: 3, url: 'https://example.com/other' }];

    await openOrFocusTab('https://example.com/a');

    expect(tabsCreate).toHaveBeenCalled();
  });

  it('lets failures reach the caller, which is what reports them', async () => {
    // One caller shows the error on the row that failed; the other logs it.
    tabsCreate.mockRejectedValueOnce(new Error('cannot create'));

    await expect(openOrFocusTab('https://example.com/a')).rejects.toThrow('cannot create');
  });
});

describe('focusTab', () => {
  it('tolerates a tab with no id or window', async () => {
    await expect(focusTab({} as chrome.tabs.Tab)).resolves.toBeUndefined();
    expect(tabsUpdate).not.toHaveBeenCalled();
  });
});
