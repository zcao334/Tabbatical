import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitActivation, handleTabReplaced, initializeExistingTabs, trackTab } from './activity';
import { getLastActiveTabByWindow, getTabActivityMap, setTabActivity } from '../shared/storage';
import { MS_PER_DAY, type TabActivity } from '../shared/types';

const NOW = new Date('2026-08-19T09:00:00Z').getTime();
const WINDOW = 1;

let store: Record<string, unknown> = {};
let tabs: chrome.tabs.Tab[] = [];

function fakeTab(tabId: number, overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    active: true,
    windowId: WINDOW,
    groupId: -1,
    pinned: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabs: {
    get: async (tabId: number) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) throw new Error(`No tab ${tabId}`);
      return tab;
    },
    query: async () => tabs,
  },
});

async function track(tabId: number, overrides: Partial<TabActivity> = {}): Promise<void> {
  await setTabActivity({
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    lastActiveAt: NOW - MS_PER_DAY,
    revisitCount: 0,
    groupId: null,
    pinned: false,
    ...overrides,
  });
}

const revisitsFor = async (tabId: number) => (await getTabActivityMap())[tabId]?.revisitCount;

beforeEach(() => {
  store = {};
  tabs = [fakeTab(1), fakeTab(2)];
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('commitActivation', () => {
  it('marks the tab as active now', async () => {
    await track(1, { lastActiveAt: NOW - 5 * MS_PER_DAY });

    await commitActivation(1, WINDOW);

    expect((await getTabActivityMap())[1].lastActiveAt).toBe(NOW);
  });

  it('counts a return from another tab as a revisit', async () => {
    await track(1);
    await track(2);

    await commitActivation(1, WINDOW);
    await commitActivation(2, WINDOW);

    expect(await revisitsFor(2)).toBe(1);
  });

  it('does not count the first tab seen in a window', async () => {
    // There is nothing to have come back from.
    await track(1);

    await commitActivation(1, WINDOW);

    expect(await revisitsFor(1)).toBe(0);
  });

  it('does not count re-activating the tab already in front', async () => {
    await track(1);

    await commitActivation(1, WINDOW);
    await commitActivation(1, WINDOW);

    expect(await revisitsFor(1)).toBe(0);
  });

  it('keeps counting after the service worker has been unloaded', async () => {
    // The regression this module exists for. An MV3 worker is unloaded after
    // roughly thirty seconds idle, so the previous tab has to come back from
    // storage; when it lived in a Map, every activation after an unload looked
    // like a first visit and the count stopped moving.
    await track(1);
    await track(2);

    await commitActivation(1, WINDOW);

    // The unload lands here, between the two switches — which is the whole
    // problem, since thirty seconds on one tab is ordinary browsing. A fresh
    // module instance is what a revived worker is: module scope is gone and
    // only storage survives. Resetting *after* both switches would leave the
    // second one with the first still in memory, and pass either way.
    vi.resetModules();
    const revived = await import('./activity');
    await revived.commitActivation(2, WINDOW);

    expect(await revisitsFor(2)).toBe(1);
  });

  it('keeps each window’s history to itself', async () => {
    // Two windows each showing their own tab: focusing one is not a return
    // within the other.
    tabs = [fakeTab(1), fakeTab(2, { windowId: 2 })];
    await track(1);
    await track(2);

    await commitActivation(1, 1);
    await commitActivation(2, 2);

    expect(await revisitsFor(2)).toBe(0);
  });

  it('does not count a first sighting of an untracked tab', async () => {
    // The tab is recorded, but arriving somewhere new is a visit, not a return.
    await track(1);
    await commitActivation(1, WINDOW);

    await commitActivation(2, WINDOW);

    expect(await revisitsFor(2)).toBe(0);
  });

  it('records the window’s last-active tab for the next activation', async () => {
    await track(1);

    await commitActivation(1, WINDOW);

    expect(await getLastActiveTabByWindow()).toEqual({ [WINDOW]: 1 });
  });

  it('writes nothing when the tab closed before it dwelled long enough', async () => {
    await track(1);
    tabs = [];

    await commitActivation(1, WINDOW);

    expect((await getTabActivityMap())[1].lastActiveAt).toBe(NOW - MS_PER_DAY);
  });

  it('writes nothing when the user has already moved on', async () => {
    tabs = [fakeTab(1, { active: false })];
    await track(1);

    await commitActivation(1, WINDOW);

    expect((await getTabActivityMap())[1].lastActiveAt).toBe(NOW - MS_PER_DAY);
    expect(await getLastActiveTabByWindow()).toEqual({});
  });
});

describe('handleTabReplaced', () => {
  it('moves the tracked history onto the new tab id', async () => {
    await track(1, { revisitCount: 4 });

    await handleTabReplaced(99, 1);

    const map = await getTabActivityMap();
    expect(map[1]).toBeUndefined();
    expect(map[99]).toMatchObject({ tabId: 99, revisitCount: 4 });
  });

  it('follows the window’s last-active tab onto the new id', async () => {
    // Otherwise the window still points at a dead id, so coming back to the
    // very same tab reads as a switch and counts a revisit that never happened.
    await track(1);
    await track(2);
    await commitActivation(1, WINDOW);

    await handleTabReplaced(99, 1);
    tabs = [fakeTab(99), fakeTab(2)];
    await commitActivation(99, WINDOW);

    expect(await revisitsFor(99)).toBe(0);
  });
});

describe('trackTab', () => {
  it('does not create an entry for an unknown tab when told not to', async () => {
    await trackTab(fakeTab(3), { createIfMissing: false });

    expect((await getTabActivityMap())[3]).toBeUndefined();
  });

  it('refreshes an existing entry without resetting its idle clock', async () => {
    // A title change is not activity.
    await track(1, { lastActiveAt: NOW - 5 * MS_PER_DAY, revisitCount: 2 });

    await trackTab(fakeTab(1, { title: 'Renamed' }), { createIfMissing: false });

    expect((await getTabActivityMap())[1]).toMatchObject({
      title: 'Renamed',
      lastActiveAt: NOW - 5 * MS_PER_DAY,
      revisitCount: 2,
    });
  });
});

describe('initializeExistingTabs', () => {
  it('drops tabs that went away while the extension was not running', async () => {
    await track(1);
    await track(42);

    await initializeExistingTabs();

    const map = await getTabActivityMap();
    expect(map[42]).toBeUndefined();
    expect(map[1]).toBeDefined();
  });

  it('starts tracking tabs that are already open', async () => {
    await initializeExistingTabs();

    expect(Object.keys(await getTabActivityMap())).toEqual(['1', '2']);
  });
});
