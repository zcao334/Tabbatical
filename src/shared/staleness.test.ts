import { describe, expect, it } from 'vitest';
import { STALENESS_WEIGHTS, computeStaleness, sanitizeStalenessConfig } from './staleness';
import { DEFAULT_STALENESS_CONFIG } from './types';

const now = 1_000_000_000_000; // arbitrary fixed epoch ms

describe('computeStaleness', () => {
  it('scores an idle tab higher than a recently active one', () => {
    const dayMs = 1000 * 60 * 60 * 24;
    const idle = computeStaleness(
      { lastActiveAt: now - 10 * dayMs, revisitCount: 0, pinned: false, isInActiveGroup: false },
      now,
    );
    const recent = computeStaleness(
      { lastActiveAt: now - 1 * dayMs, revisitCount: 0, pinned: false, isInActiveGroup: false },
      now,
    );
    expect(idle).toBeGreaterThan(recent);
  });

  it('reduces score as revisit count increases', () => {
    const base = computeStaleness(
      { lastActiveAt: now - 5 * 86_400_000, revisitCount: 0, pinned: false, isInActiveGroup: false },
      now,
    );
    const revisited = computeStaleness(
      { lastActiveAt: now - 5 * 86_400_000, revisitCount: 4, pinned: false, isInActiveGroup: false },
      now,
    );
    expect(revisited).toBeLessThan(base);
  });

  it('applies a large penalty to pinned tabs, keeping them low-priority', () => {
    const pinned = computeStaleness(
      { lastActiveAt: now - 30 * 86_400_000, revisitCount: 0, pinned: true, isInActiveGroup: false },
      now,
    );
    expect(pinned).toBeLessThan(0);
  });

  it('applies the active-group penalty', () => {
    const ungrouped = computeStaleness(
      { lastActiveAt: now - 5 * 86_400_000, revisitCount: 0, pinned: false, isInActiveGroup: false },
      now,
    );
    const grouped = computeStaleness(
      { lastActiveAt: now - 5 * 86_400_000, revisitCount: 0, pinned: false, isInActiveGroup: true },
      now,
    );
    expect(grouped).toBe(ungrouped - DEFAULT_STALENESS_CONFIG.activeGroupPenalty);
  });

  it('returns 0 for a tab active right now with no history', () => {
    const score = computeStaleness(
      { lastActiveAt: now, revisitCount: 0, pinned: false, isInActiveGroup: false },
      now,
    );
    expect(score).toBe(0);
  });
});

describe('sanitizeStalenessConfig', () => {
  it('takes stored weights as given when they are in range', () => {
    const stored = {
      idleDayWeight: 20,
      revisitWeight: 1,
      activeGroupPenalty: 0,
      pinnedPenalty: 500,
    };

    expect(sanitizeStalenessConfig(stored)).toEqual(stored);
  });

  it('falls back to the defaults for anything absent', () => {
    // An older record written before a weight existed.
    expect(sanitizeStalenessConfig({ idleDayWeight: 20 })).toEqual({
      ...DEFAULT_STALENESS_CONFIG,
      idleDayWeight: 20,
    });
  });

  it('keeps the good fields when one is unusable', () => {
    // All-or-nothing here would silently discard three settings the user did
    // set because of one they didn't.
    const config = sanitizeStalenessConfig({ idleDayWeight: 20, revisitWeight: NaN });

    expect(config.idleDayWeight).toBe(20);
    expect(config.revisitWeight).toBe(DEFAULT_STALENESS_CONFIG.revisitWeight);
  });

  it('rejects values that are not numbers, including numeric strings', () => {
    // '10' would survive arithmetic and score wrongly rather than visibly.
    for (const bad of ['10', null, {}, [], true, undefined]) {
      expect(sanitizeStalenessConfig({ idleDayWeight: bad }).idleDayWeight).toBe(
        DEFAULT_STALENESS_CONFIG.idleDayWeight,
      );
    }
  });

  it('rejects NaN and both infinities', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(sanitizeStalenessConfig({ pinnedPenalty: bad }).pinnedPenalty).toBe(
        DEFAULT_STALENESS_CONFIG.pinnedPenalty,
      );
    }
  });

  it('clamps rather than discarding an out-of-range value', () => {
    // The intent behind a too-large number is legible, so honour it at the
    // limit instead of silently reverting to a default the user didn't pick.
    const weight = STALENESS_WEIGHTS.find((entry) => entry.key === 'idleDayWeight')!;

    expect(sanitizeStalenessConfig({ idleDayWeight: 10_000 }).idleDayWeight).toBe(weight.max);
    expect(sanitizeStalenessConfig({ idleDayWeight: -5 }).idleDayWeight).toBe(weight.min);
  });

  it('returns the defaults for input that is not an object at all', () => {
    for (const bad of [undefined, null, 'nonsense', 42, []]) {
      expect(sanitizeStalenessConfig(bad)).toEqual(DEFAULT_STALENESS_CONFIG);
    }
  });

  it('ignores keys that are not weights', () => {
    const config = sanitizeStalenessConfig({ ...DEFAULT_STALENESS_CONFIG, somethingElse: 9 });

    expect(config).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('describes every weight in the config, and only those', () => {
    // The form renders from this list, so a weight missing from it would be
    // unreachable in the UI while still scoring.
    expect(STALENESS_WEIGHTS.map((weight) => weight.key).sort()).toEqual(
      Object.keys(DEFAULT_STALENESS_CONFIG).sort(),
    );
  });

  it('leaves every default inside its own bounds', () => {
    for (const weight of STALENESS_WEIGHTS) {
      const value = DEFAULT_STALENESS_CONFIG[weight.key];
      expect(value).toBeGreaterThanOrEqual(weight.min);
      expect(value).toBeLessThanOrEqual(weight.max);
    }
  });
});
