import type { TabActivity } from '../shared/types';
import { getTabActivityMap, removeTabActivity, setTabActivity } from '../shared/storage';

// A tab must stay active continuously for this long before it's recorded —
// filters out incidental alt-tab flicker from counting as a real visit.
const ACTIVE_DWELL_MS = 15_000;

// Tracks each window's most-recently-*committed* tab (i.e. one that cleared
// the dwell threshold) so a revisit only counts against confirmed activity,
// not raw activation events.
const lastActiveTabIdByWindow = new Map<number, number>();
const pendingActivationTimers = new Map<number, ReturnType<typeof setTimeout>>();

function toActivity(tab: chrome.tabs.Tab, previous?: TabActivity): TabActivity {
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

async function trackTab(tab: chrome.tabs.Tab, { createIfMissing = true } = {}): Promise<void> {
  if (tab.id == null) return;
  const map = await getTabActivityMap();
  const existing = map[tab.id];
  if (!existing && !createIfMissing) return;
  await setTabActivity(toActivity(tab, existing));
}

async function initializeExistingTabs(): Promise<void> {
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

async function commitActivation(tabId: number, windowId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return; // tab was closed before it dwelled long enough to commit
  }
  if (!tab.active) return; // user already moved on again

  const previousTabId = lastActiveTabIdByWindow.get(windowId);
  lastActiveTabIdByWindow.set(windowId, tabId);

  const map = await getTabActivityMap();
  const existing = map[tabId];
  const isRevisit = previousTabId !== undefined && previousTabId !== tabId && existing !== undefined;

  const activity = toActivity(tab, existing);
  activity.lastActiveAt = Date.now();
  if (isRevisit) activity.revisitCount += 1;

  await setTabActivity(activity);
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior', error));

chrome.runtime.onInstalled.addListener(() => {
  void initializeExistingTabs();
});
chrome.runtime.onStartup.addListener(() => {
  void initializeExistingTabs();
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const existingTimer = pendingActivationTimers.get(windowId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingActivationTimers.delete(windowId);
    void commitActivation(tabId, windowId);
  }, ACTIVE_DWELL_MS);

  pendingActivationTimers.set(windowId, timer);
});

const RELEVANT_CHANGE_KEYS: (keyof chrome.tabs.TabChangeInfo)[] = [
  'status',
  'title',
  'pinned',
  'groupId',
];

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const isRelevant = RELEVANT_CHANGE_KEYS.some((key) => changeInfo[key] !== undefined);
  if (!isRelevant) return;
  // Keep title/url fresh for already-tracked tabs, but don't let a page load
  // event fast-track a brand-new tab into the digest before it dwells.
  await trackTab(tab, { createIfMissing: false });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabActivity(tabId);
});
