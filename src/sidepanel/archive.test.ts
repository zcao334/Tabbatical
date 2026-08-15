import { describe, expect, it } from 'vitest';
import { formatArchivedAt } from './archive';

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
