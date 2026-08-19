/**
 * What's due for review.
 *
 * Shared because two surfaces ask the same question from different places: the
 * digest renders the ranking in the side panel, and the badge counts it in the
 * service worker. A second copy of the scoring would be a ranking that
 * disagrees with the number sitting on the toolbar icon.
 */

import { computeStaleness } from './staleness';
import { getStalenessConfig, getTabActivityMap } from './storage';
import type { TabActivity } from './types';

export interface ScoredTab {
  activity: TabActivity;
  staleness: number;
}

/**
 * Above this score a tab is worth surfacing unprompted.
 *
 * With the default weights this is roughly three idle days for a tab that was
 * never revisited — far enough past "I'm still using this" to be worth a
 * badge, and short enough that a genuinely forgotten tab doesn't sit unnoticed
 * for a week. Revisits, pinning and active grouping all subtract, so a tab you
 * actually use has to be idle much longer before it counts.
 */
export const REVIEW_STALENESS_THRESHOLD = 30;

async function getActiveGroupIds(): Promise<Set<number>> {
  const groups = await chrome.tabGroups.query({ collapsed: false });
  return new Set(groups.map((group) => group.id));
}

/** Every tracked tab, scored and ranked stalest first. */
export async function scoreTrackedTabs(now: number = Date.now()): Promise<ScoredTab[]> {
  const [map, activeGroupIds, config] = await Promise.all([
    getTabActivityMap(),
    getActiveGroupIds(),
    getStalenessConfig(),
  ]);

  return Object.values(map)
    .map((activity) => ({
      activity,
      staleness: computeStaleness(
        {
          lastActiveAt: activity.lastActiveAt,
          revisitCount: activity.revisitCount,
          pinned: activity.pinned,
          isInActiveGroup: activity.groupId != null && activeGroupIds.has(activity.groupId),
        },
        now,
        config,
      ),
    }))
    .sort((a, b) => b.staleness - a.staleness);
}

export function countDueForReview(scored: ScoredTab[]): number {
  return scored.filter((tab) => tab.staleness >= REVIEW_STALENESS_THRESHOLD).length;
}

/**
 * Recomputed on a schedule as well as on change, because staleness moves with
 * the clock: a tab crosses the threshold by sitting still, which fires no
 * event of its own.
 */
export const REVIEW_ALARM_NAME = 'tabbatical:review';

/**
 * Half-hourly. The threshold is measured in days, so this is far finer than it
 * needs to be for accuracy — it's chosen so the badge is never more than a few
 * minutes stale when the user glances at it, at a cost of one storage read.
 */
export const REVIEW_ALARM_PERIOD_MINUTES = 30;
