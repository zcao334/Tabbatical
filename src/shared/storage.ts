import type { SnoozedTab, TabActivity } from './types';

const TAB_ACTIVITY_KEY = 'tabActivityMap';
const SNOOZED_TABS_KEY = 'snoozedTabs';

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? {};
}

/**
 * Read-modify-write a stored map in a single pass.
 *
 * One write per change, never a remove followed by a set: two sequential
 * writes leave a window where an entry is absent from the map, which a
 * concurrent render shows as a row that disappears and comes back.
 */
async function updateMap<T>(
  key: string,
  mutate: (map: Record<string, T>) => void,
): Promise<void> {
  const map = await readMap<T>(key);
  mutate(map);
  await chrome.storage.local.set({ [key]: map });
}

/** Keyed by tab id. Numeric in the type, string at runtime, as JSON requires. */
export type TabActivityMap = Record<number, TabActivity>;

export async function getTabActivityMap(): Promise<TabActivityMap> {
  return (await readMap<TabActivity>(TAB_ACTIVITY_KEY)) as TabActivityMap;
}

export async function setTabActivity(activity: TabActivity): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    map[activity.tabId] = activity;
  });
}

export async function removeTabActivity(tabId: number): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    delete map[tabId];
  });
}

/**
 * Move a tab's tracked history onto a new tab id.
 *
 * Chrome doesn't keep a tab's id when it discards it — the tab is replaced by
 * a fresh one and chrome.tabs.onReplaced reports the swap. Without this the
 * map keeps the dead id, so the digest shows an entry whose chrome.tabs.get
 * throws, and archiving it fails outright.
 */
export async function replaceTabActivity(
  removedTabId: number,
  addedTabId: number,
): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    const existing = map[removedTabId];
    if (!existing) return;

    delete map[removedTabId];
    // Idle time and revisit count describe the page, not the id Chrome happens
    // to be using for it, so they carry over untouched.
    map[addedTabId] = { ...existing, tabId: addedTabId };
  });
}

export async function patchTabActivity(
  tabId: number,
  patch: Partial<TabActivity>,
): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    const existing = map[tabId];
    if (!existing) return;
    map[tabId] = { ...existing, ...patch };
  });
}

/**
 * Snoozed tabs, keyed by their generated id.
 *
 * Separate from the activity map because the two have opposite lifetimes: an
 * activity entry is a cache of a live tab and is pruned whenever that tab
 * goes away, while a snooze entry is the only remaining record of a tab that
 * was deliberately closed, and must survive exactly the events that clear the
 * other one.
 */
export type SnoozedTabMap = Record<string, SnoozedTab>;

export async function getSnoozedTabs(): Promise<SnoozedTabMap> {
  return readMap<SnoozedTab>(SNOOZED_TABS_KEY);
}

export async function addSnoozedTab(entry: SnoozedTab): Promise<void> {
  await updateMap<SnoozedTab>(SNOOZED_TABS_KEY, (map) => {
    map[entry.id] = entry;
  });
}

export async function removeSnoozedTab(id: string): Promise<void> {
  await updateMap<SnoozedTab>(SNOOZED_TABS_KEY, (map) => {
    delete map[id];
  });
}
