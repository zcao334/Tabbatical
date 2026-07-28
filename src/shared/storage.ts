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
