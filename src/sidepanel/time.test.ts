import { describe, expect, it } from 'vitest';
import { formatArchivedAt, formatDaysIdle, formatWakeIn } from './time';

const NOW = new Date('2026-08-14T12:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatArchivedAt', () => {
  it('labels the last minute as just now', () => {
    expect(formatArchivedAt(NOW, NOW)).toBe('just now');
    expect(formatArchivedAt(NOW - 59_000, NOW)).toBe('just now');
  });

  it('never reads as negative when the timestamp is slightly ahead', () => {
    // Clock skew between the service worker's write and the panel's read.
    expect(formatArchivedAt(NOW + 5_000, NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatArchivedAt(NOW - 5 * MINUTE, NOW)).toBe('5m ago');
    expect(formatArchivedAt(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(formatArchivedAt(NOW - 2 * DAY, NOW)).toBe('2d ago');
  });

  it('switches to a date once relative time stops being readable', () => {
    // A week out, "43d ago" is harder to place than a calendar date.
    const old = formatArchivedAt(NOW - 30 * DAY, NOW);
    expect(old).not.toMatch(/ago|just now/);
  });

  it('does not skip a unit at the boundaries', () => {
    expect(formatArchivedAt(NOW - MINUTE, NOW)).toBe('1m ago');
    expect(formatArchivedAt(NOW - HOUR, NOW)).toBe('1h ago');
    expect(formatArchivedAt(NOW - DAY, NOW)).toBe('1d ago');
  });
});

describe('formatDaysIdle', () => {
  it('buckets everything inside a day as active today', () => {
    expect(formatDaysIdle(NOW, NOW)).toBe('active today');
    expect(formatDaysIdle(NOW - 23 * HOUR, NOW)).toBe('active today');
  });

  it('counts whole days once a tab has gone a day untouched', () => {
    expect(formatDaysIdle(NOW - DAY, NOW)).toBe('1d idle');
    expect(formatDaysIdle(NOW - 5 * DAY, NOW)).toBe('5d idle');
  });

  it('truncates rather than rounding up', () => {
    // A tab idle for a day and a half is not two days idle.
    expect(formatDaysIdle(NOW - 1.9 * DAY, NOW)).toBe('1d idle');
  });

  it('does not read as negative when the timestamp is slightly ahead', () => {
    expect(formatDaysIdle(NOW + HOUR, NOW)).toBe('active today');
  });
});

describe('formatWakeIn', () => {
  it('counts down in minutes, then hours, then days', () => {
    expect(formatWakeIn(NOW + 5 * MINUTE, NOW)).toBe('back in 5m');
    expect(formatWakeIn(NOW + 3 * HOUR, NOW)).toBe('back in 3h');
    expect(formatWakeIn(NOW + 2 * DAY, NOW)).toBe('back in 2d');
  });

  it('does not skip a unit at the boundaries', () => {
    expect(formatWakeIn(NOW + MINUTE, NOW)).toBe('back in 1m');
    expect(formatWakeIn(NOW + HOUR, NOW)).toBe('back in 1h');
    expect(formatWakeIn(NOW + DAY, NOW)).toBe('back in 1d');
  });

  it('truncates rather than rounding up to the next unit', () => {
    // "back in 24h" would be worse than the day it is about to become.
    expect(formatWakeIn(NOW + 23.9 * HOUR, NOW)).toBe('back in 23h');
    expect(formatWakeIn(NOW + 6.9 * DAY, NOW)).toBe('back in 6d');
  });

  it('says something useful in the last minute', () => {
    expect(formatWakeIn(NOW + 30_000, NOW)).toBe('back in under a minute');
  });

  it('reads as due rather than counting backwards once the time has passed', () => {
    // The alarm may not have fired yet, or fired while the panel was open.
    expect(formatWakeIn(NOW, NOW)).toBe('due now');
    expect(formatWakeIn(NOW - HOUR, NOW)).toBe('due now');
  });

  it('switches to a date once a countdown stops being readable', () => {
    const far = formatWakeIn(NOW + 30 * DAY, NOW);
    expect(far).toMatch(/^back /);
    expect(far).not.toMatch(/back in/);
  });
});
