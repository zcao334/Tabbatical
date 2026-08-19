/**
 * Snooze durations and alarm naming.
 *
 * Kept free of chrome APIs so the parsing and the name encoding can be tested
 * directly, and so the side panel and the service worker agree on both without
 * one importing the other's module.
 */

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_WEEK } from './types';

/**
 * Chrome throttles alarms shorter than a minute in a packed extension, so
 * anything below this wouldn't fire when the user expects it to.
 */
export const MIN_SNOOZE_MS = MS_PER_MINUTE;

/**
 * A year out. Not a technical limit — it's the point where a typo ("100w")
 * stops being a plausible intent and starts being a tab the user never sees
 * again.
 */
export const MAX_SNOOZE_MS = 365 * MS_PER_DAY;

export interface SnoozePreset {
  label: string;
  ms: number;
}

/**
 * The one-click durations. Deliberately two: the row already carries Keep and
 * Archive, and every extra preset costs width that the title needs more.
 * Anything else goes through the custom field.
 */
export const SNOOZE_PRESETS: SnoozePreset[] = [
  { label: '1 day', ms: MS_PER_DAY },
  { label: '1 week', ms: MS_PER_WEEK },
];

const UNIT_MS: Record<string, number> = {
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: MS_PER_WEEK,
};

/**
 * Units are matched in full and then keyed by first letter, which is safe only
 * because no two accepted units share one — note the absence of "month", which
 * would collide with "minute" and is why it isn't offered.
 */
const DURATION_PATTERN =
  /^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/i;

/**
 * Parse a duration like "30m", "2 hours", "3d", "1w" into milliseconds.
 *
 * Returns null for anything unparseable or out of range, so a caller can't
 * accidentally schedule a wake-up from a typo. Fractions are accepted ("1.5h")
 * because they read naturally, and rounded to whole milliseconds since that's
 * the resolution an alarm has.
 */
export function parseDuration(input: string): number | null {
  const match = DURATION_PATTERN.exec(input.trim());
  if (!match) return null;

  const ms = Number(match[1]) * UNIT_MS[match[2][0].toLowerCase()];
  if (!Number.isFinite(ms)) return null;
  if (ms < MIN_SNOOZE_MS || ms > MAX_SNOOZE_MS) return null;

  return Math.round(ms);
}

/**
 * Alarms share one namespace across the whole extension, so snooze alarms are
 * prefixed and every handler checks the prefix rather than assuming an alarm
 * is one of ours. Week 4's review cadence (#10) will add its own.
 */
const ALARM_PREFIX = 'tabbatical:snooze:';

export function snoozeAlarmName(id: string): string {
  return `${ALARM_PREFIX}${id}`;
}

/** The snooze id inside an alarm name, or null if the alarm isn't a snooze. */
export function snoozeIdFromAlarm(alarmName: string): string | null {
  if (!alarmName.startsWith(ALARM_PREFIX)) return null;
  return alarmName.slice(ALARM_PREFIX.length) || null;
}
