import { describe, expect, it } from 'vitest';
import {
  MAX_SNOOZE_MS,
  MIN_SNOOZE_MS,
  parseDuration,
  snoozeAlarmName,
  snoozeIdFromAlarm,
} from './snooze';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('parseDuration', () => {
  it('reads each unit', () => {
    expect(parseDuration('30m')).toBe(30 * MINUTE);
    expect(parseDuration('2h')).toBe(2 * HOUR);
    expect(parseDuration('3d')).toBe(3 * DAY);
    expect(parseDuration('1w')).toBe(WEEK);
  });

  it('accepts spelled-out units and surrounding space', () => {
    expect(parseDuration('2 hours')).toBe(2 * HOUR);
    expect(parseDuration('  1 day ')).toBe(DAY);
    expect(parseDuration('3 weeks')).toBe(3 * WEEK);
    expect(parseDuration('45 mins')).toBe(45 * MINUTE);
  });

  it('is case-insensitive', () => {
    expect(parseDuration('2H')).toBe(2 * HOUR);
    expect(parseDuration('1 Week')).toBe(WEEK);
  });

  it('accepts fractions, since "1.5h" reads naturally', () => {
    expect(parseDuration('1.5h')).toBe(90 * MINUTE);
  });

  it('rejects anything it cannot read', () => {
    // A typo must not become a wake-up time — there's no way for the user to
    // notice a tab that came back at the wrong moment.
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('5')).toBeNull();
    expect(parseDuration('d')).toBeNull();
    expect(parseDuration('2h30m')).toBeNull();
    expect(parseDuration('-3d')).toBeNull();
  });

  it('rejects months, which would be ambiguous with minutes', () => {
    expect(parseDuration('2mo')).toBeNull();
    expect(parseDuration('2 months')).toBeNull();
  });

  it('rejects durations Chrome would throttle', () => {
    expect(parseDuration('30s')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
    expect(parseDuration('1m')).toBe(MIN_SNOOZE_MS);
  });

  it('rejects durations far enough out to be a typo', () => {
    expect(parseDuration('100w')).toBeNull();
    expect(parseDuration('365d')).toBe(MAX_SNOOZE_MS);
  });
});

describe('snooze alarm names', () => {
  it('round-trips an id', () => {
    const id = '2f1c8b64-0f7a-4a1e-9b2d-2f0a1b3c4d5e';
    expect(snoozeIdFromAlarm(snoozeAlarmName(id))).toBe(id);
  });

  it('ignores alarms belonging to other features', () => {
    // Alarms share one namespace extension-wide, so the review cadence (#10)
    // will land alarms here that snooze must not try to reopen.
    expect(snoozeIdFromAlarm('tabbatical:review')).toBeNull();
    expect(snoozeIdFromAlarm('some-other-alarm')).toBeNull();
  });

  it('ignores a prefix with no id after it', () => {
    expect(snoozeIdFromAlarm('tabbatical:snooze:')).toBeNull();
  });
});
