/**
 * Relative-time labels for the panel's lists.
 *
 * The views date things differently and the phrasings don't interchange — the
 * archive looks backwards ("2h ago"), the snoozed list forwards ("back in
 * 2h"). What they do share is the calendar format they fall back to once
 * relative time stops being readable, which is why they live together here
 * rather than one per view.
 */

import { MS_PER_DAY } from '../shared/types';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

export const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Recent captures get a relative label because "2h ago" is what the user is
 * actually reasoning about when reviewing today's archiving; older ones get a
 * date, since "43 days ago" is harder to place than "Jul 2".
 */
export function formatArchivedAt(archivedAt: number, now: number = Date.now()): string {
  const elapsed = now - archivedAt;

  // Clock skew or an entry written a moment ago shouldn't read "in -1 minutes".
  if (elapsed < MS_PER_MINUTE) return 'just now';
  if (elapsed < MS_PER_HOUR) return `${Math.floor(elapsed / MS_PER_MINUTE)}m ago`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}h ago`;
  if (elapsed < MS_PER_WEEK) return `${Math.floor(elapsed / MS_PER_DAY)}d ago`;
  return DATE_FORMAT.format(archivedAt);
}

/**
 * How long until a snoozed tab returns.
 *
 * Truncates rather than rounds, matching formatArchivedAt: "back in 1h" for
 * anything in the next hour and a half is the same convention as "1h ago",
 * and a label that rounds up to a unit boundary ("back in 24h") reads worse
 * than the next unit down.
 */
export function formatWakeIn(wakeAt: number, now: number = Date.now()): string {
  const remaining = wakeAt - now;

  // Overdue: the alarm hasn't fired yet, or fired while the panel was open.
  // Either way this row is about to disappear, so it says so rather than
  // counting backwards.
  if (remaining <= 0) return 'due now';

  if (remaining < MS_PER_MINUTE) return 'back in under a minute';
  if (remaining < MS_PER_HOUR) return `back in ${Math.floor(remaining / MS_PER_MINUTE)}m`;
  if (remaining < MS_PER_DAY) return `back in ${Math.floor(remaining / MS_PER_HOUR)}h`;
  if (remaining < MS_PER_WEEK) return `back in ${Math.floor(remaining / MS_PER_DAY)}d`;
  return `back ${DATE_FORMAT.format(wakeAt)}`;
}
