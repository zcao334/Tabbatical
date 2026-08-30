import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBadgeCount, handleReviewAlarm, refreshBadge, scheduleReviewAlarm } from './badge';
import { REVIEW_ALARM_NAME, REVIEW_ALARM_PERIOD_MINUTES } from '../shared/review';
import { setTabActivity } from '../shared/storage';
import { MS_PER_DAY, type TabActivity } from '../shared/types';

const NOW = new Date('2026-08-19T09:00:00Z').getTime();

let store: Record<string, unknown> = {};

const setBadgeText = vi.fn(async (_details: { text: string }) => {});
const setBadgeBackgroundColor = vi.fn(async (_details: { color: string }) => {});
const setBadgeTextColor = vi.fn(async (_details: { color: string }) => {});
const alarmsCreate = vi.fn(async (_name: string, _info: chrome.alarms.AlarmCreateInfo) => {});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabGroups: { query: async () => [] },
  notifications: { create: async () => 'id', clear: async () => true },
  action: { setBadgeText, setBadgeBackgroundColor, setBadgeTextColor },
  alarms: { create: alarmsCreate },
});

async function trackIdleTabs(count: number, idleDays = 5): Promise<void> {
  for (let tabId = 1; tabId <= count; tabId++) {
    const activity: TabActivity = {
      tabId,
      url: `https://example.com/${tabId}`,
      title: `Tab ${tabId}`,
      lastActiveAt: NOW - idleDays * MS_PER_DAY,
      revisitCount: 0,
      groupId: null,
      pinned: false,
    };
    await setTabActivity(activity);
  }
}

const badgeText = () => setBadgeText.mock.calls.at(-1)?.[0].text;

beforeEach(() => {
  store = {};
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('formatBadgeCount', () => {
  it('shows the count', () => {
    expect(formatBadgeCount(1)).toBe('1');
    expect(formatBadgeCount(42)).toBe('42');
  });

  it('shows nothing at zero, rather than a 0', () => {
    // An idle profile should wear no badge at all.
    expect(formatBadgeCount(0)).toBe('');
    expect(formatBadgeCount(-1)).toBe('');
  });

  it('caps once the exact number stops being actionable', () => {
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(4000)).toBe('99+');
  });
});

describe('refreshBadge', () => {
  it('counts the tabs that are due', async () => {
    await trackIdleTabs(3);

    await refreshBadge();

    expect(badgeText()).toBe('3');
  });

  it('clears the badge when nothing is due', async () => {
    await trackIdleTabs(2, 0);

    await refreshBadge();

    expect(badgeText()).toBe('');
  });

  it('clears the badge on an empty profile', async () => {
    await refreshBadge();

    expect(badgeText()).toBe('');
  });

  it('colours the badge only when it is showing something', async () => {
    await refreshBadge();
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();

    await trackIdleTabs(1);
    await refreshBadge();
    expect(setBadgeBackgroundColor).toHaveBeenCalledOnce();
  });

  it('survives a Chrome build with no badge text colour API', async () => {
    // setBadgeTextColor is newer than the rest; Chrome contrasts it itself
    // where the call isn't available.
    await trackIdleTabs(1);
    const chromeAction = chrome.action as unknown as Record<string, unknown>;
    const original = chromeAction.setBadgeTextColor;
    delete chromeAction.setBadgeTextColor;

    await refreshBadge();
    chromeAction.setBadgeTextColor = original;

    expect(badgeText()).toBe('1');
  });

  it('does not throw when the badge cannot be painted', async () => {
    // A failed repaint must not take down the caller — this runs from startup
    // and from the storage listener.
    setBadgeText.mockRejectedValueOnce(new Error('no such window'));

    await expect(refreshBadge()).resolves.toBeUndefined();
  });
});

describe('the review alarm', () => {
  it('recurs, so a tab can go stale without any event firing', async () => {
    await scheduleReviewAlarm();

    expect(alarmsCreate).toHaveBeenCalledWith(REVIEW_ALARM_NAME, {
      periodInMinutes: REVIEW_ALARM_PERIOD_MINUTES,
    });
  });

  it('repaints when it fires', async () => {
    await trackIdleTabs(2);

    await handleReviewAlarm({ name: REVIEW_ALARM_NAME } as chrome.alarms.Alarm);

    expect(badgeText()).toBe('2');
  });

  it('ignores a snooze alarm', async () => {
    // Both handlers see every alarm, so each has to recognise its own.
    await handleReviewAlarm({ name: 'tabbatical:snooze:abc' } as chrome.alarms.Alarm);

    expect(setBadgeText).not.toHaveBeenCalled();
  });
});

describe('the review tick', () => {
  it('scores the tabs once and shares the result', async () => {
    // The badge and the prompt ask the same question of the same data at the
    // same instant. Scoring twice is wasted work, and worse, it lets them
    // disagree about what is due.
    await trackIdleTabs(2);
    const storageGet = vi.spyOn(chrome.storage.local, 'get');

    await handleReviewAlarm({ name: REVIEW_ALARM_NAME } as chrome.alarms.Alarm);

    const activityReads = storageGet.mock.calls.filter(
      (call) => call[0] === 'tabActivityMap',
    ).length;
    expect(activityReads).toBe(1);
  });
});
