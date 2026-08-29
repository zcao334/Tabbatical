import { forgetWindow, removeTabActivity, setSessionStartedAt } from '../shared/storage';
import {
  commitActivation,
  handleTabReplaced,
  initializeExistingTabs,
  trackTab,
} from './activity';
import {
  isArchiveTabRequest,
  isExtractTabRequest,
  isSnoozeActionRequest,
  isSnoozeTabRequest,
  type SnoozeActionResponse,
} from '../shared/messages';
import { extractTabContent } from './extraction';
import { archiveTab } from './archive';
import { cancelSnooze, handleSnoozeAlarm, reconcileSnoozes, snoozeTab, wakeSnoozedTab } from './snooze';
import { handleReviewAlarm, refreshBadge, scheduleReviewAlarm } from './badge';
import { handleNotificationButton, handleNotificationClick } from './prompt';

// A tab must stay active continuously for this long before it's recorded —
// filters out incidental alt-tab flicker from counting as a real visit.
const ACTIVE_DWELL_MS = 7_000;

// Pending dwell timers, one per window. In memory on purpose, unlike the
// last-active tab this feeds: a timer is meaningless once the worker unloads,
// since the activation it was waiting to confirm is over.
const pendingActivationTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Set on every startup rather than once at install: setPanelBehavior writes
// persistent profile state, so a profile that ran a build which turned this
// off keeps it off until something turns it back on.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Tabbatical] Failed to set the action behaviour', error));

async function start(): Promise<void> {
  await initializeExistingTabs();
  await reconcileSnoozes();
  await scheduleReviewAlarm();
  // Starts the prompt's grace period. This runs on browser startup and on
  // install/update, which is exactly when the user has something else in mind.
  await setSessionStartedAt(Date.now());
  // After reconciling, so the first count reflects anything that woke on the
  // way up rather than the state the browser was last closed in.
  await refreshBadge();
}

chrome.runtime.onInstalled.addListener(() => {
  void start();
});
chrome.runtime.onStartup.addListener(() => {
  void start();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleSnoozeAlarm(alarm);
  void handleReviewAlarm(alarm);
});

// Keeps the badge honest between scheduled recounts: closing, keeping,
// archiving and snoozing all land here as a write to the tracking map, and a
// weight change re-scores every tracked tab, so the count can move without a
// single tab having moved. Cheap enough to run on each — a read and a tab-group
// query, with no write of its own, so this cannot feed back into itself.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !(changes.tabActivityMap || changes.stalenessConfig)) return;
  void refreshBadge();
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

// The prompt is the one part of the extension the user did not initiate, so
// both ways of answering it are wired: the body and the action buttons.
chrome.notifications.onClicked.addListener((notificationId) => {
  void handleNotificationClick(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  void handleNotificationButton(notificationId, buttonIndex);
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await handleTabReplaced(addedTabId, removedTabId);
});

// A closed window's last-active tab is never consulted again, so drop it
// rather than let dead window ids accumulate.
chrome.windows.onRemoved.addListener(async (windowId) => {
  pendingActivationTimers.delete(windowId);
  await forgetWindow(windowId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Only claim the response channel for messages we actually handle —
  // returning true unconditionally would leave other senders awaiting a
  // reply that never comes.
  if (isArchiveTabRequest(message)) {
    archiveTab(message.tabId).then(sendResponse);
    return true;
  }
  if (isExtractTabRequest(message)) {
    extractTabContent(message.tabId).then(sendResponse);
    return true;
  }
  if (isSnoozeTabRequest(message)) {
    snoozeTab(message.tabId, message.durationMs).then(sendResponse);
    return true;
  }
  if (isSnoozeActionRequest(message)) {
    const { action, id } = message;
    (action === 'wake' ? wakeSnoozedTab(id) : cancelSnooze(id))
      .then((): SnoozeActionResponse => ({ status: 'ok' }))
      .catch((error): SnoozeActionResponse => {
        console.error('[Tabbatical] Snooze action failed', error);
        return { status: 'failed' };
      })
      .then(sendResponse);
    return true;
  }
  return;
});
