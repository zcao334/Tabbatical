import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_STALENESS_THRESHOLD,
  countDueForReview,
  scoreTrackedTabs,
  type ScoredTab,
} from './review';
import { setTabActivity } from './storage';
import { MS_PER_DAY, type TabActivity } from './types';

const NOW = new Date('2026-08-19T09:00:00Z').getTime();

let store: Record<string, unknown> = {};
let groups: Array<{ id: number }> = [];

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabGroups: { query: async () => groups },
});

async function track(tabId: number, overrides: Partial<TabActivity> = {}): Promise<void> {
  await setTabActivity({
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    lastActiveAt: NOW,
    revisitCount: 0,
    groupId: null,
    pinned: false,
    ...overrides,
  });
}

const scored = (staleness: number): ScoredTab => ({
  activity: {} as TabActivity,
  staleness,
});

beforeEach(() => {
  store = {};
  groups = [];
});

describe('scoreTrackedTabs', () => {
  it('ranks the stalest first', async () => {
    await track(1, { lastActiveAt: NOW - MS_PER_DAY });
    await track(2, { lastActiveAt: NOW - 9 * MS_PER_DAY });
    await track(3, { lastActiveAt: NOW - 4 * MS_PER_DAY });

    const ranked = await scoreTrackedTabs(NOW);

    expect(ranked.map((tab) => tab.activity.tabId)).toEqual([2, 3, 1]);
  });

  it('discounts a tab that sits in an open group', async () => {
    await track(1, { lastActiveAt: NOW - 3 * MS_PER_DAY, groupId: 7 });
    await track(2, { lastActiveAt: NOW - 3 * MS_PER_DAY });
    groups = [{ id: 7 }];

    const [first, second] = await scoreTrackedTabs(NOW);

    expect(first.activity.tabId).toBe(2);
    expect(second.staleness).toBeLessThan(first.staleness);
  });

  it('ignores a group id that is not currently open', async () => {
    // A collapsed group is not somewhere the user is working, so it earns no
    // discount — chrome.tabGroups.query only returns the open ones.
    await track(1, { lastActiveAt: NOW - 3 * MS_PER_DAY, groupId: 7 });
    await track(2, { lastActiveAt: NOW - 3 * MS_PER_DAY });
    groups = [];

    const ranked = await scoreTrackedTabs(NOW);

    expect(ranked[0].staleness).toBe(ranked[1].staleness);
  });

  it('is empty when nothing is tracked', async () => {
    expect(await scoreTrackedTabs(NOW)).toEqual([]);
  });
});

describe('countDueForReview', () => {
  it('counts only what clears the threshold', () => {
    expect(
      countDueForReview([
        scored(REVIEW_STALENESS_THRESHOLD + 1),
        scored(REVIEW_STALENESS_THRESHOLD - 1),
        scored(0),
      ]),
    ).toBe(1);
  });

  it('includes a tab sitting exactly on the threshold', () => {
    expect(countDueForReview([scored(REVIEW_STALENESS_THRESHOLD)])).toBe(1);
  });

  it('counts nothing in an empty or fresh profile', () => {
    expect(countDueForReview([])).toBe(0);
    expect(countDueForReview([scored(0), scored(-1000)])).toBe(0);
  });

  it('does not count a pinned tab that has been idle for weeks', async () => {
    // The pinned penalty is meant to keep such tabs out of the review loop
    // entirely, badge included.
    await track(1, { lastActiveAt: NOW - 30 * MS_PER_DAY, pinned: true });

    expect(countDueForReview(await scoreTrackedTabs(NOW))).toBe(0);
  });

  it('counts a tab left alone for several days', async () => {
    await track(1, { lastActiveAt: NOW - 5 * MS_PER_DAY });

    expect(countDueForReview(await scoreTrackedTabs(NOW))).toBe(1);
  });

  it('does not count a tab used today', async () => {
    await track(1, { lastActiveAt: NOW - 3_600_000 });

    expect(countDueForReview(await scoreTrackedTabs(NOW))).toBe(0);
  });
});
