/**
 * The toolbar badge: how many tabs are due for review.
 *
 * The ambient half of the review signal. It costs the user nothing and is
 * there whenever they happen to look — but that is also its limit: a number
 * seen every day for a week stops registering, and a signal that waits to be
 * noticed only ever reaches someone already thinking about their tabs. The
 * daily prompt in ./prompt.ts is the half that initiates. The two are meant to
 * be read together, the badge answering "how many?" and the prompt asking
 * "now?".
 */

import {
  REVIEW_ALARM_NAME,
  REVIEW_ALARM_PERIOD_MINUTES,
  countDueForReview,
  scoreTrackedTabs,
  type ScoredTab,
} from '../shared/review';
import { maybePromptReview } from './prompt';

/** Matches the panel's accent, so the badge reads as part of the same thing. */
const BADGE_COLOR = '#1a73e8';

/**
 * Past this the exact number stops being actionable and the badge only has
 * room for so much text.
 */
const MAX_BADGE_COUNT = 99;

export function formatBadgeCount(due: number): string {
  // Empty string is how Chrome is told to show no badge at all — an idle
  // profile shouldn't wear a "0".
  if (due <= 0) return '';
  return due > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(due);
}

/**
 * Repaint. Never throws: a failed badge must not break a caller.
 *
 * Takes an already-scored list when the caller has one, since scoring reads
 * storage and queries every tab group — work worth doing once per event rather
 * than once per thing that happens to need it.
 */
export async function refreshBadge(scored?: ScoredTab[]): Promise<void> {
  try {
    const text = formatBadgeCount(countDueForReview(scored ?? (await scoreTrackedTabs())));

    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      // Chrome picks a contrasting colour on its own where this isn't
      // available, so it's an improvement rather than a requirement.
      await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (error) {
    console.error('[Tabbatical] Failed to refresh the badge', error);
  }
}

/**
 * Start the recurring recount.
 *
 * Staleness moves with the clock, so a tab crosses the threshold by sitting
 * still — which fires no event. Change notifications alone would leave the
 * badge frozen on whatever the last tab action left behind.
 *
 * Safe to call on every startup: creating an alarm that already exists
 * replaces it rather than stacking a second one.
 */
export async function scheduleReviewAlarm(): Promise<void> {
  await chrome.alarms.create(REVIEW_ALARM_NAME, {
    periodInMinutes: REVIEW_ALARM_PERIOD_MINUTES,
  });
}

/**
 * Repaints on the review alarm, ignoring alarms belonging to other features.
 *
 * The daily prompt rides this same tick rather than owning an alarm: see
 * maybePromptReview for why a daily alarm would be worse.
 */
export async function handleReviewAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== REVIEW_ALARM_NAME) return;

  // Scored once and shared. Both readers ask the same question of the same
  // data at the same instant, so scoring twice is not just wasted work — it
  // lets the badge and the prompt disagree about what is due.
  const scored = await scoreTrackedTabs();
  await refreshBadge(scored);
  await maybePromptReview(Date.now(), scored);
}
