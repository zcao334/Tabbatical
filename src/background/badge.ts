/**
 * The toolbar badge: how many tabs are due for review.
 *
 * This is what makes the extension proactive rather than a place you have to
 * remember to visit. It is deliberately the quietest signal that still works —
 * a notification would need its own permission and would interrupt on the
 * extension's schedule rather than the user's, whereas a badge is there when
 * they happen to look and invisible when there's nothing to say.
 */

import {
  REVIEW_ALARM_NAME,
  REVIEW_ALARM_PERIOD_MINUTES,
  countDueForReview,
  scoreTrackedTabs,
} from '../shared/review';

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

/** Recount and repaint. Never throws: a failed badge must not break a caller. */
export async function refreshBadge(): Promise<void> {
  try {
    const text = formatBadgeCount(countDueForReview(await scoreTrackedTabs()));

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

/** Repaints on the review alarm, ignoring alarms belonging to other features. */
export async function handleReviewAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== REVIEW_ALARM_NAME) return;
  await refreshBadge();
}
