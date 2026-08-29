import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleNotificationButton,
  handleNotificationClick,
  maybePromptReview,
  openReview,
} from './prompt';
import { savePromptConfig, setLastPromptedAt, setSessionStartedAt } from '../shared/storage';
import { PROMPT_INTERVAL_MS, STARTUP_GRACE_MS } from '../shared/prompt';
import { setTabActivity } from '../shared/storage';
import { MS_PER_DAY, type TabActivity } from '../shared/types';

const NOW = new Date('2026-08-19T09:00:00Z').getTime();
const NOTIFICATION_ID = 'tabbatical:review-prompt';

let store: Record<string, unknown> = {};

const notificationsCreate =
  vi.fn(async (_id: string, _options: chrome.notifications.NotificationOptions) => NOTIFICATION_ID);
const notificationsClear = vi.fn(async () => true);
const sidePanelOpen = vi.fn(async () => {});
const tabsCreate = vi.fn(async () => ({ id: 42, windowId: 9 }) as chrome.tabs.Tab);
const tabsUpdate = vi.fn(async () => ({}) as chrome.tabs.Tab);
const windowsUpdate = vi.fn(async () => ({}) as chrome.windows.Window);
const getLastFocused = vi.fn(
  async () => ({ id: 7, left: 100, top: 50, width: 1200, height: 900 }) as chrome.windows.Window,
);

/** Extension pages the browser is pretending to have open. */
let openReviewTabs: Array<Partial<chrome.tabs.Tab>> = [];
const tabsQuery = vi.fn(async () => openReviewTabs);

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabGroups: { query: async () => [] },
  notifications: { create: notificationsCreate, clear: notificationsClear },
  sidePanel: { open: sidePanelOpen },
  tabs: { query: tabsQuery, update: tabsUpdate, create: tabsCreate },
  windows: { getLastFocused, update: windowsUpdate },
  runtime: { getURL: (path: string) => `chrome-extension://abc/${path}` },
});

/** Seeds tabs idle long enough to clear the review threshold. */
async function trackStaleTabs(count: number): Promise<void> {
  for (let tabId = 1; tabId <= count; tabId++) {
    const activity: TabActivity = {
      tabId,
      url: `https://example.com/${tabId}`,
      title: `Tab ${tabId}`,
      lastActiveAt: NOW - 5 * MS_PER_DAY,
      revisitCount: 0,
      groupId: null,
      pinned: false,
    };
    await setTabActivity(activity);
  }
}

/** Puts the profile in a state where a prompt is owed. */
async function readyToPrompt(staleTabs = 8): Promise<void> {
  await trackStaleTabs(staleTabs);
  await setSessionStartedAt(NOW - STARTUP_GRACE_MS - 1);
  await setLastPromptedAt(NOW - PROMPT_INTERVAL_MS - 1);
}

const lastMessage = () => notificationsCreate.mock.calls.at(-1)?.[1]?.message as string | undefined;
const promptedAt = () =>
  (store.reviewPromptState as { lastPromptedAt: number } | undefined)?.lastPromptedAt;

beforeEach(() => {
  store = {};
  vi.clearAllMocks();
  openReviewTabs = [];
  tabsQuery.mockImplementation(async () => openReviewTabs);
  getLastFocused.mockImplementation(
    async () => ({ id: 7, left: 100, top: 50, width: 1200, height: 900 }) as chrome.windows.Window,
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('maybePromptReview', () => {
  it('shows the prompt when one is owed', async () => {
    await readyToPrompt();

    await maybePromptReview(NOW);

    expect(notificationsCreate).toHaveBeenCalledOnce();
  });

  it('uses a fixed id, so prompts replace rather than stack', async () => {
    await readyToPrompt();

    await maybePromptReview(NOW);

    expect(notificationsCreate.mock.calls[0][0]).toBe(NOTIFICATION_ID);
  });

  it('says nothing on a profile with no stale tabs', async () => {
    // The reason default-on is defensible: a fresh install cannot be nagged.
    await setSessionStartedAt(NOW - STARTUP_GRACE_MS - 1);
    await setLastPromptedAt(0);

    await maybePromptReview(NOW);

    expect(notificationsCreate).not.toHaveBeenCalled();
  });

  it('says nothing when the user has turned it off', async () => {
    await readyToPrompt();
    await savePromptConfig({ enabled: false });

    await maybePromptReview(NOW);

    expect(notificationsCreate).not.toHaveBeenCalled();
  });

  it('does not prompt again on the next alarm tick', async () => {
    // The alarm fires every 30 minutes; this is what keeps it to once a day.
    await readyToPrompt();

    await maybePromptReview(NOW);
    await maybePromptReview(NOW + 30 * 60_000);
    await maybePromptReview(NOW + 60 * 60_000);

    expect(notificationsCreate).toHaveBeenCalledOnce();
  });

  it('prompts again a day later', async () => {
    await readyToPrompt();

    await maybePromptReview(NOW);
    await maybePromptReview(NOW + PROMPT_INTERVAL_MS);

    expect(notificationsCreate).toHaveBeenCalledTimes(2);
  });

  it('records the prompt before showing it, so a failure cannot loop', async () => {
    // If the timestamp were written after a successful create, a throw here
    // would leave it unset and the next tick would try again in 30 minutes —
    // one prompt a day becoming one every half hour.
    await readyToPrompt();
    notificationsCreate.mockRejectedValueOnce(new Error('notifications disabled'));

    await maybePromptReview(NOW);
    await maybePromptReview(NOW + 30 * 60_000);

    expect(promptedAt()).toBe(NOW);
    expect(notificationsCreate).toHaveBeenCalledOnce();
  });

  it('does not throw when notifications are unavailable', async () => {
    await readyToPrompt();
    notificationsCreate.mockRejectedValueOnce(new Error('nope'));

    await expect(maybePromptReview(NOW)).resolves.toBeUndefined();
  });

  it('offers the batch rather than the whole backlog', async () => {
    await readyToPrompt(12);

    await maybePromptReview(NOW);

    expect(lastMessage()).toContain('Review 5');
  });

  it('offers only what is due when that is fewer than the batch', async () => {
    await readyToPrompt(2);

    await maybePromptReview(NOW);

    expect(lastMessage()).toContain('2 tabs');
  });
});

describe('answering the prompt', () => {
  it('opens the side panel when the notification is clicked', async () => {
    await handleNotificationClick(NOTIFICATION_ID);

    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 });
  });

  it('clears the notification once answered', async () => {
    await handleNotificationClick(NOTIFICATION_ID);

    expect(notificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
  });

  it('ignores notifications belonging to anything else', async () => {
    await handleNotificationClick('some-other-extension-thing');

    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(notificationsClear).not.toHaveBeenCalled();
  });

  it('opens the review on the Review button', async () => {
    await handleNotificationButton(NOTIFICATION_ID, 0);

    expect(sidePanelOpen).toHaveBeenCalledOnce();
  });

  it('only dismisses on Not today', async () => {
    await handleNotificationButton(NOTIFICATION_ID, 1);

    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(notificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
  });

  it('needs no bookkeeping to dismiss, since showing it already counted', async () => {
    await readyToPrompt();
    await maybePromptReview(NOW);

    await handleNotificationButton(NOTIFICATION_ID, 1);
    await maybePromptReview(NOW + 30 * 60_000);

    expect(notificationsCreate).toHaveBeenCalledOnce();
  });
});

describe('openReview', () => {
  it('falls back to a tab when the side panel refuses to open', async () => {
    // sidePanel.open() needs a user gesture and it is undocumented whether a
    // notification click counts as one, so this path is a coin flip, not an
    // error case.
    sidePanelOpen.mockRejectedValueOnce(new Error('user gesture required'));

    await openReview();

    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://abc/src/sidepanel/index.html?surface=tab',
    });
  });

  it('does not also open a tab when the panel opened fine', async () => {
    await openReview();

    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('survives both routes failing', async () => {
    sidePanelOpen.mockRejectedValueOnce(new Error('nope'));
    tabsCreate.mockRejectedValueOnce(new Error('also nope'));

    await expect(openReview()).resolves.toBeUndefined();
  });
});

describe('a prompt following an unanswered one', () => {
  it('retracts the previous prompt before posting the next', async () => {
    // Creating with an id still sitting in the notification centre updates it
    // silently instead of announcing it, so a user who never dismissed
    // yesterday's prompt would simply stop being told. Found in the browser:
    // the first prompt alerted, the next two did not.
    await readyToPrompt();

    await maybePromptReview(NOW);

    const cleared = notificationsClear.mock.invocationCallOrder[0];
    const created = notificationsCreate.mock.invocationCallOrder[0];
    expect(notificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
    expect(cleared).toBeLessThan(created);
  });

  it('clears before each repeat prompt, not just the first', async () => {
    await readyToPrompt();

    await maybePromptReview(NOW);
    await setLastPromptedAt(NOW - PROMPT_INTERVAL_MS - 1);
    await maybePromptReview(NOW);

    expect(notificationsClear).toHaveBeenCalledTimes(2);
    expect(notificationsCreate).toHaveBeenCalledTimes(2);
  });

  it('still posts the prompt when there was nothing to clear', async () => {
    // The usual case — nothing outstanding — must not be punished for it.
    await readyToPrompt();
    notificationsClear.mockRejectedValueOnce(new Error('no such notification'));

    await maybePromptReview(NOW);

    expect(notificationsCreate).toHaveBeenCalledOnce();
  });
});

describe('bringing the browser forward', () => {
  it('focuses the window when the review opens in a tab', async () => {
    // The click often comes from another application, so a tab opened behind
    // an unfocused Chrome means nothing visibly happens — the review sits
    // unseen, which is the outcome the prompt exists to escape.
    sidePanelOpen.mockRejectedValueOnce(new Error('user gesture required'));

    await openReview();

    expect(tabsCreate).toHaveBeenCalled();
    expect(windowsUpdate).toHaveBeenCalledWith(9, { focused: true });
  });

  it('focuses the window when the side panel opens', async () => {
    await openReview();

    expect(windowsUpdate).toHaveBeenCalledWith(7, { focused: true });
  });

  it('opens the review from the notification body, focused', async () => {
    sidePanelOpen.mockRejectedValueOnce(new Error('user gesture required'));

    await handleNotificationClick(NOTIFICATION_ID);

    expect(windowsUpdate).toHaveBeenCalledWith(9, { focused: true });
  });
});

describe('reusing an open review', () => {
  beforeEach(() => {
    // The panel route never succeeds from a notification click on current
    // Chrome, so every test here exercises the path users actually get.
    sidePanelOpen.mockRejectedValue(new Error('user gesture required'));
  });

  it('reuses a review tab that is already open', async () => {
    // The body and the Review button both land here, so a prompt can be
    // answered twice — a second identical tab is the mess this extension
    // exists to prevent.
    openReviewTabs = [{ id: 3, windowId: 11 }];

    await openReview();

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(tabsUpdate).toHaveBeenCalledWith(3, { active: true });
  });

  it('brings the reused tab’s window forward rather than leaving it buried', async () => {
    openReviewTabs = [{ id: 3, windowId: 11 }];

    await openReview();

    expect(windowsUpdate).toHaveBeenCalledWith(11, { focused: true });
  });

  it('opens one when there is nothing to reuse', async () => {
    await openReview();

    expect(tabsCreate).toHaveBeenCalledOnce();
  });
});
