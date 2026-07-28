import type { TabActivity } from '../shared/types';
import { getTabActivityMap, removeTabActivity, setTabActivity } from '../shared/storage';

// Tracks each window's most-recently-active tab so a revisit only counts
// when the user actually switches away and back, not on every activation event.
const lastActiveTabIdByWindow = new Map<number, number>();

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

async function trackTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null) return;
  const map = await getTabActivityMap();
  const activity = toActivity(tab, map[tab.id]);
  await setTabActivity(activity);
}

async function initializeExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await trackTab(tab);
  }
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

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const previousTabId = lastActiveTabIdByWindow.get(windowId);
  lastActiveTabIdByWindow.set(windowId, tabId);

  const tab = await chrome.tabs.get(tabId);
  const map = await getTabActivityMap();
  const existing = map[tabId];
  const isRevisit = previousTabId !== undefined && previousTabId !== tabId && existing !== undefined;

  const activity = toActivity(tab, existing);
  activity.lastActiveAt = Date.now();
  if (isRevisit) activity.revisitCount += 1;

  await setTabActivity(activity);
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
  await trackTab(tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabActivity(tabId);
});
