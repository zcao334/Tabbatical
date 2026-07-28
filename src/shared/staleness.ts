import { DEFAULT_STALENESS_CONFIG, type StalenessConfig, type TabActivity } from './types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
  score -= tab.revisitCount * config.revisitWeight;
  if (tab.isInActiveGroup) score -= config.activeGroupPenalty;
  if (tab.pinned) score -= config.pinnedPenalty;

  return score;
}
