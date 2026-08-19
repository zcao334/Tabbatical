/**
 * Keeping the tracked-tab map in step with the browser.
 *
 * Split out of the service worker so it can be tested: the worker file is
 * listener wiring that runs on import, which a test can't drive, and the
 * revisit rule below is exactly the kind of thing that looks obviously correct
 * and isn't.
 */

import {
  getLastActiveTabByWindow,
  getTabActivityMap,
  removeTabActivity,
  replaceLastActiveTab,
  replaceTabActivity,
  setLastActiveTab,
  setTabActivity,
} from '../shared/storage';
import type { TabActivity } from '../shared/types';

export function toActivity(tab: chrome.tabs.Tab, previous?: TabActivity): TabActivity {
  return {
    tabId: tab.id!,
    url: tab.url ?? previous?.url ?? '',
    title: tab.title ?? previous?.title ?? '',
    lastActiveAt: previous?.lastActiveAt ?? Date.now(),
    revisitCount: previous?.revisitCount ?? 0,
    groupId: tab.groupId != null && tab.groupId >= 0 ? tab.groupId : null,
    pinned: tab.pinned ?? false,
  };
}

export async function trackTab(
  tab: chrome.tabs.Tab,
  { createIfMissing = true } = {},
): Promise<void> {
  if (tab.id == null) return;
  const map = await getTabActivityMap();
  const existing = map[tab.id];
  if (!existing && !createIfMissing) return;
  await setTabActivity(toActivity(tab, existing));
}

export async function initializeExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const currentTabIds = new Set(tabs.map((tab) => tab.id).filter((id): id is number => id != null));

  // A tab closed while Chrome shuts down abruptly never fires onRemoved, so
  // reconcile storage against reality on every install/startup instead of
  // only ever adding to it.
  const map = await getTabActivityMap();
  for (const tabIdKey of Object.keys(map)) {
    const tabId = Number(tabIdKey);
    if (!currentTabIds.has(tabId)) {
      await removeTabActivity(tabId);
    }
  }

  for (const tab of tabs) {
    await trackTab(tab);
  }
}

/**
 * Record a tab as active, once it has been active long enough to mean it.
 *
 * A revisit is "the user came back to this tab from a different one", so it
 * needs the window's previous tab to compare against — which is read from
 * storage rather than memory, because this worker is unloaded between
 * activations far more often than not.
 */
export async function commitActivation(tabId: number, windowId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return; // tab was closed before it dwelled long enough to commit
  }
  if (!tab.active) return; // user already moved on again

  const previousTabId = (await getLastActiveTabByWindow())[windowId];
  await setLastActiveTab(windowId, tabId);

  const map = await getTabActivityMap();
  const existing = map[tabId];
  // Not a revisit when there's no previous tab to have come from (a fresh
  // profile, or the first activation in a new window), when the user never
  // left this tab, or when this tab isn't tracked yet — a first sighting is a
  // visit, not a return.
  const isRevisit = previousTabId !== undefined && previousTabId !== tabId && existing !== undefined;

  const activity = toActivity(tab, existing);
  activity.lastActiveAt = Date.now();
  if (isRevisit) activity.revisitCount += 1;

  await setTabActivity(activity);
}

/**
 * Migrate a tab's history when Chrome discards it.
 *
 * Discarding swaps the tab for a fresh one with a new id and fires
 * onReplaced instead of onRemoved. These are precisely the idle tabs the
 * digest surfaces, so without this the digest would show entries whose
 * chrome.tabs.get throws.
 */
export async function handleTabReplaced(
  addedTabId: number,
  removedTabId: number,
): Promise<void> {
  await replaceLastActiveTab(removedTabId, addedTabId);
  await replaceTabActivity(removedTabId, addedTabId);
}
