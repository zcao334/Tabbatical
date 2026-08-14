import type { TabActivity } from './types';

const STORAGE_KEY = 'tabActivityMap';

export type TabActivityMap = Record<number, TabActivity>;

export async function getTabActivityMap(): Promise<TabActivityMap> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? {};
}

export async function setTabActivity(activity: TabActivity): Promise<void> {
  const map = await getTabActivityMap();
  map[activity.tabId] = activity;
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

export async function removeTabActivity(tabId: number): Promise<void> {
  const map = await getTabActivityMap();
  delete map[tabId];
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

/**
 * Move a tab's tracked history onto a new tab id.
 *
 * Chrome doesn't keep a tab's id when it discards it — the tab is replaced by
 * a fresh one and chrome.tabs.onReplaced reports the swap. Without this the
 * map keeps the dead id, so the digest shows an entry whose chrome.tabs.get
 * throws, and archiving it fails outright.
 *
 * Deliberately one read-modify-write rather than removeTabActivity followed
 * by setTabActivity: two sequential writes would leave a window where the tab
 * is absent from the map, which a concurrent render would show as a
 * disappearing row.
 */
export async function replaceTabActivity(
  removedTabId: number,
  addedTabId: number,
): Promise<void> {
  const map = await getTabActivityMap();
  const existing = map[removedTabId];
  if (!existing) return;

  delete map[removedTabId];
  // Idle time and revisit count describe the page, not the id Chrome happens
  // to be using for it, so they carry over untouched.
  map[addedTabId] = { ...existing, tabId: addedTabId };
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

export async function patchTabActivity(
  tabId: number,
  patch: Partial<TabActivity>,
): Promise<void> {
  const map = await getTabActivityMap();
  const existing = map[tabId];
  if (!existing) return;
  map[tabId] = { ...existing, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}
