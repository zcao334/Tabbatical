import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSnoozedTab,
  getSnoozedTabs,
  getTabActivityMap,
  removeSnoozedTab,
  forgetWindow,
  getLastActiveTabByWindow,
  getPromptConfig,
  getPromptState,
  getStalenessConfig,
  removeTabActivity,
  replaceTabActivity,
  replaceLastActiveTab,
  resetStalenessConfig,
  savePromptConfig,
  setLastPromptedAt,
  setSessionStartedAt,
  saveStalenessConfig,
  setLastActiveTab,
  setTabActivity,
  type TabActivityMap,
} from './storage';
import { DEFAULT_PROMPT_CONFIG } from './prompt';
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

describe('the last-active tab per window', () => {
  it('starts empty', async () => {
    expect(await getLastActiveTabByWindow()).toEqual({});
  });

  it('records a tab against its window', async () => {
    await setLastActiveTab(1, 42);

    expect(await getLastActiveTabByWindow()).toEqual({ 1: 42 });
  });

  it('keeps windows independent', async () => {
    await setLastActiveTab(1, 42);
    await setLastActiveTab(2, 7);

    expect(await getLastActiveTabByWindow()).toEqual({ 1: 42, 2: 7 });
  });

  it('overwrites the window’s previous tab rather than accumulating', async () => {
    await setLastActiveTab(1, 42);
    await setLastActiveTab(1, 43);

    expect(await getLastActiveTabByWindow()).toEqual({ 1: 43 });
  });

  it('drops a closed window', async () => {
    await setLastActiveTab(1, 42);
    await setLastActiveTab(2, 7);

    await forgetWindow(1);

    expect(await getLastActiveTabByWindow()).toEqual({ 2: 7 });
  });

  it('follows a discarded tab onto its replacement id', async () => {
    await setLastActiveTab(1, 42);
    await setLastActiveTab(2, 42);

    await replaceLastActiveTab(42, 99);

    expect(await getLastActiveTabByWindow()).toEqual({ 1: 99, 2: 99 });
  });

  it('leaves other windows alone when replacing an id', async () => {
    await setLastActiveTab(1, 42);
    await setLastActiveTab(2, 7);

    await replaceLastActiveTab(42, 99);

    expect(await getLastActiveTabByWindow()).toEqual({ 1: 99, 2: 7 });
  });
});

describe('the prompt config', () => {
  it('reads as the defaults before anything is saved', async () => {
    expect(await getPromptConfig()).toEqual(DEFAULT_PROMPT_CONFIG);
  });

  it('round-trips a change', async () => {
    await savePromptConfig({ enabled: false });

    expect(await getPromptConfig()).toEqual({ ...DEFAULT_PROMPT_CONFIG, enabled: false });
  });

  it('sanitizes a record it did not write', async () => {
    store.promptConfig = { enabled: 'yes please', batchSize: 900 };

    expect(await getPromptConfig()).toEqual({ enabled: true, batchSize: 25 });
  });
});

describe('the prompt state', () => {
  it('treats a profile that has never been prompted as due', async () => {
    // Seeding this with "now" would suppress the very first prompt for a day.
    expect((await getPromptState()).lastPromptedAt).toBe(0);
  });

  it('assumes the session just started when nothing is recorded', async () => {
    // The grace period should apply rather than be skipped — erring toward
    // silence, which is the safe direction for an interruption.
    const before = Date.now();

    const { sessionStartedAt } = await getPromptState();

    expect(sessionStartedAt).toBeGreaterThanOrEqual(before);
  });

  it('round-trips the last prompt time', async () => {
    await setLastPromptedAt(1_234);

    expect((await getPromptState()).lastPromptedAt).toBe(1_234);
  });

  it('keeps the two timestamps independent', async () => {
    await setLastPromptedAt(1_234);
    await setSessionStartedAt(5_678);

    expect(await getPromptState()).toEqual({ lastPromptedAt: 1_234, sessionStartedAt: 5_678 });
  });

  it('ignores a stored value that is not a number', async () => {
    store.reviewPromptState = { lastPromptedAt: 'yesterday' };

    expect((await getPromptState()).lastPromptedAt).toBe(0);
  });
});
