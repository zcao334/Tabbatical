export interface TabActivity {
  tabId: number;
  url: string;
  title: string;
  lastActiveAt: number;
  revisitCount: number;
  groupId: number | null;
  pinned: boolean;
}

export interface StalenessConfig {
  idleDayWeight: number;
  revisitWeight: number;
  activeGroupPenalty: number;
  pinnedPenalty: number;
}

export const DEFAULT_STALENESS_CONFIG: StalenessConfig = {
  idleDayWeight: 10,
  revisitWeight: 5,
  activeGroupPenalty: 15,
  pinnedPenalty: 1000,
};
