import { describe, expect, it } from 'vitest';
import { computeStaleness } from './staleness';
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
