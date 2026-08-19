import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSnoozedTab,
  getSnoozedTabs,
  getTabActivityMap,
  removeSnoozedTab,
  getStalenessConfig,
  removeTabActivity,
  replaceTabActivity,
  resetStalenessConfig,
  saveStalenessConfig,
  setTabActivity,
  type TabActivityMap,
} from './storage';
import { DEFAULT_STALENESS_CONFIG, type SnoozedTab, type TabActivity } from './types';

/** Minimal stand-in for chrome.storage.local, backed by a plain object. */
let store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
});

function activity(tabId: number, overrides: Partial<TabActivity> = {}): TabActivity {
  return {
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    lastActiveAt: 1_000,
    revisitCount: 3,
    groupId: null,
    pinned: false,
    ...overrides,
  };
}

beforeEach(() => {
  store = {};
});

describe('replaceTabActivity', () => {
  it('moves history onto the new id when Chrome discards a tab', async () => {
    await setTabActivity(activity(1, { lastActiveAt: 5_000, revisitCount: 7 }));

    await replaceTabActivity(1, 2);

    const map = await getTabActivityMap();
    expect(map[1]).toBeUndefined();
    expect(map[2]).toMatchObject({
      tabId: 2,
      url: 'https://example.com/1',
      // Idle time and revisit count describe the page, not the id.
      lastActiveAt: 5_000,
      revisitCount: 7,
    });
  });

  it('leaves other tracked tabs untouched', async () => {
    await setTabActivity(activity(1));
    await setTabActivity(activity(9));

    await replaceTabActivity(1, 2);

    const map = await getTabActivityMap();
    expect(Object.keys(map).sort()).toEqual(['2', '9']);
  });

  it('does nothing when the replaced tab was never tracked', async () => {
    await setTabActivity(activity(9));

    await replaceTabActivity(1, 2);

    const map = await getTabActivityMap();
    expect(map[2]).toBeUndefined();
    expect(map[9]).toBeDefined();
  });

  it('never leaves the map without the tab, even momentarily', async () => {
    await setTabActivity(activity(1));

    // A single write means no intermediate state a concurrent render could
    // observe as a missing row.
    const seen: TabActivityMap[] = [];
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = (async (items: Record<string, unknown>) => {
      seen.push(items.tabActivityMap as TabActivityMap);
      return originalSet(items);
    }) as typeof chrome.storage.local.set;

    await replaceTabActivity(1, 2);
    chrome.storage.local.set = originalSet;

    expect(seen).toHaveLength(1);
    expect(seen[0][2]).toBeDefined();
  });
});

describe('removeTabActivity', () => {
  it('drops only the named tab', async () => {
    await setTabActivity(activity(1));
    await setTabActivity(activity(2));

    await removeTabActivity(1);

    const map = await getTabActivityMap();
    expect(map[1]).toBeUndefined();
    expect(map[2]).toBeDefined();
  });
});

describe('snoozed tabs', () => {
  const entry = (id: string): SnoozedTab => ({
    id,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    snoozedAt: 1_000,
    wakeAt: 2_000,
  });

  it('round-trips an entry', async () => {
    await addSnoozedTab(entry('a'));

    expect(await getSnoozedTabs()).toEqual({ a: entry('a') });
  });

  it('drops only the named entry', async () => {
    await addSnoozedTab(entry('a'));
    await addSnoozedTab(entry('b'));

    await removeSnoozedTab('a');

    expect(Object.keys(await getSnoozedTabs())).toEqual(['b']);
  });

  it('survives the tab map being cleared', async () => {
    // The two buckets have opposite lifetimes: pruning a closed tab's activity
    // must never touch the record that says it is coming back.
    await setTabActivity(activity(1));
    await addSnoozedTab(entry('a'));

    await removeTabActivity(1);

    expect(await getSnoozedTabs()).toEqual({ a: entry('a') });
  });

  it('reads as empty before anything is stored', async () => {
    expect(await getSnoozedTabs()).toEqual({});
  });
});

describe('the staleness config', () => {
  it('reads as the defaults before anything is saved', async () => {
    expect(await getStalenessConfig()).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('round-trips a saved weight', async () => {
    await saveStalenessConfig({ idleDayWeight: 20 });

    expect((await getStalenessConfig()).idleDayWeight).toBe(20);
  });

  it('leaves the other weights alone when one is saved', async () => {
    // The form saves a field at a time, so this is the normal path, not an
    // edge case.
    await saveStalenessConfig({ idleDayWeight: 20 });
    await saveStalenessConfig({ revisitWeight: 1 });

    expect(await getStalenessConfig()).toEqual({
      ...DEFAULT_STALENESS_CONFIG,
      idleDayWeight: 20,
      revisitWeight: 1,
    });
  });

  it('sanitizes on the way in, so nothing unusable is ever stored', async () => {
    await saveStalenessConfig({ idleDayWeight: Number.POSITIVE_INFINITY });

    expect(store.stalenessConfig).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('sanitizes on the way out, covering a record it did not write', async () => {
    // A downgrade, a synced profile or a hand-edited record can all put
    // something here that never went through saveStalenessConfig.
    store.stalenessConfig = { idleDayWeight: 'lots', pinnedPenalty: 250 };

    expect(await getStalenessConfig()).toEqual({
      ...DEFAULT_STALENESS_CONFIG,
      pinnedPenalty: 250,
    });
  });

  it('restores the defaults', async () => {
    await saveStalenessConfig({ idleDayWeight: 20, pinnedPenalty: 0 });

    await resetStalenessConfig();

    expect(await getStalenessConfig()).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('writes the defaults out on reset rather than clearing the key', async () => {
    // A removal would reach storage listeners as an undefined newValue, which
    // a listener reading the new config would take as "no weights at all".
    await saveStalenessConfig({ idleDayWeight: 20 });

    await resetStalenessConfig();

    expect(store.stalenessConfig).toEqual(DEFAULT_STALENESS_CONFIG);
  });
});
