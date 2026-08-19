import {
  DEFAULT_STALENESS_CONFIG,
  MS_PER_DAY,
  type StalenessConfig,
  type TabActivity,
} from './types';

export interface StalenessInput extends Pick<TabActivity, 'lastActiveAt' | 'revisitCount' | 'pinned'> {
  isInActiveGroup: boolean;
}

export function computeStaleness(
  tab: StalenessInput,
  now: number,
  config: StalenessConfig = DEFAULT_STALENESS_CONFIG,
): number {
  const daysSinceLastActive = Math.max(0, now - tab.lastActiveAt) / MS_PER_DAY;

  let score = daysSinceLastActive * config.idleDayWeight;
  // Capped: revisits are never forgotten, so an uncapped discount would let a
  // tab opened often enough sit below the review threshold permanently, long
  // after it stopped being one the user actually returns to.
  score -= Math.min(tab.revisitCount * config.revisitWeight, config.maxRevisitPenalty);
  if (tab.isInActiveGroup) score -= config.activeGroupPenalty;
  if (tab.pinned) score -= config.pinnedPenalty;

  return score;
}

/**
 * What each weight means and what it's allowed to be.
 *
 * One list rather than a set of constants because three things need to agree
 * on it: the settings form renders from it, the sanitizer validates against
 * it, and the bounds below are the only thing standing between a typo in an
 * editable field and a scoring function that ranks nothing.
 */
export interface StalenessWeight {
  key: keyof StalenessConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
}

export const STALENESS_WEIGHTS: StalenessWeight[] = [
  {
    key: 'idleDayWeight',
    label: 'Points per idle day',
    hint: 'The only weight that adds. Raise it to have tabs come up for review sooner.',
    min: 0,
    max: 100,
  },
  {
    key: 'revisitWeight',
    label: 'Points off per revisit',
    hint: 'How much coming back to a tab protects it from being surfaced.',
    min: 0,
    max: 100,
  },
  {
    key: 'maxRevisitPenalty',
    label: 'Most points revisits can take off',
    hint: 'A ceiling, so a much-used tab still comes up for review eventually.',
    min: 0,
    max: 10_000,
  },
  {
    key: 'activeGroupPenalty',
    label: 'Points off when in an open group',
    hint: 'A tab in a group you have expanded is somewhere you are working.',
    min: 0,
    max: 1_000,
  },
  {
    key: 'pinnedPenalty',
    label: 'Points off when pinned',
    hint: 'Large by default, so pinned tabs stay out of review entirely.',
    min: 0,
    max: 100_000,
  },
];

/**
 * Coerce whatever is in storage into a usable config.
 *
 * Per-key rather than all-or-nothing: one unreadable field falls back to its
 * own default and leaves the other three as the user set them. Storage here
 * outlives any single version of the extension — it survives downgrades, and
 * a weight added in a later version is simply absent in an older record — so
 * "some of this is missing or wrong" is the normal case, not a corrupt one.
 */
export function sanitizeStalenessConfig(stored: unknown): StalenessConfig {
  const source = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;

  const config = { ...DEFAULT_STALENESS_CONFIG };
  for (const weight of STALENESS_WEIGHTS) {
    const value = source[weight.key];
    // Number.isFinite rejects NaN and both infinities, and the typeof guard
    // rejects the numeric strings a hand-edited storage record would hold —
    // "10" * 2 would otherwise score silently and wrongly.
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    config[weight.key] = Math.min(Math.max(value, weight.min), weight.max);
  }

  return config;
}
