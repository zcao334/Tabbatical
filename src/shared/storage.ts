import { sanitizePromptConfig, type PromptConfig } from './prompt';
import { sanitizeStalenessConfig } from './staleness';
import { DEFAULT_STALENESS_CONFIG, type SnoozedTab, type StalenessConfig, type TabActivity } from './types';

const TAB_ACTIVITY_KEY = 'tabActivityMap';
const SNOOZED_TABS_KEY = 'snoozedTabs';
const LAST_ACTIVE_TAB_KEY = 'lastActiveTabByWindow';
const PROMPT_STATE_KEY = 'reviewPromptState';
export const STALENESS_CONFIG_KEY = 'stalenessConfig';
export const PROMPT_CONFIG_KEY = 'promptConfig';

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? {};
}

/**
 * Read-modify-write a stored map in a single pass.
 *
 * One write per change, never a remove followed by a set: two sequential
 * writes leave a window where an entry is absent from the map, which a
 * concurrent render shows as a row that disappears and comes back.
 */
async function updateMap<T>(
  key: string,
  mutate: (map: Record<string, T>) => void,
): Promise<void> {
  const map = await readMap<T>(key);
  mutate(map);
  await chrome.storage.local.set({ [key]: map });
}

/** Keyed by tab id. Numeric in the type, string at runtime, as JSON requires. */
export type TabActivityMap = Record<number, TabActivity>;

export async function getTabActivityMap(): Promise<TabActivityMap> {
  return (await readMap<TabActivity>(TAB_ACTIVITY_KEY)) as TabActivityMap;
}

export async function setTabActivity(activity: TabActivity): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    map[activity.tabId] = activity;
  });
}

export async function removeTabActivity(tabId: number): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    delete map[tabId];
  });
}

/**
 * Move a tab's tracked history onto a new tab id.
 *
 * Chrome doesn't keep a tab's id when it discards it — the tab is replaced by
 * a fresh one and chrome.tabs.onReplaced reports the swap. Without this the
 * map keeps the dead id, so the digest shows an entry whose chrome.tabs.get
 * throws, and archiving it fails outright.
 */
export async function replaceTabActivity(
  removedTabId: number,
  addedTabId: number,
): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    const existing = map[removedTabId];
    if (!existing) return;

    delete map[removedTabId];
    // Idle time and revisit count describe the page, not the id Chrome happens
    // to be using for it, so they carry over untouched.
    map[addedTabId] = { ...existing, tabId: addedTabId };
  });
}

export async function patchTabActivity(
  tabId: number,
  patch: Partial<TabActivity>,
): Promise<void> {
  await updateMap<TabActivity>(TAB_ACTIVITY_KEY, (map) => {
    const existing = map[tabId];
    if (!existing) return;
    map[tabId] = { ...existing, ...patch };
  });
}

/**
 * Snoozed tabs, keyed by their generated id.
 *
 * Separate from the activity map because the two have opposite lifetimes: an
 * activity entry is a cache of a live tab and is pruned whenever that tab
 * goes away, while a snooze entry is the only remaining record of a tab that
 * was deliberately closed, and must survive exactly the events that clear the
 * other one.
 */
export type SnoozedTabMap = Record<string, SnoozedTab>;

export async function getSnoozedTabs(): Promise<SnoozedTabMap> {
  return readMap<SnoozedTab>(SNOOZED_TABS_KEY);
}

export async function addSnoozedTab(entry: SnoozedTab): Promise<void> {
  await updateMap<SnoozedTab>(SNOOZED_TABS_KEY, (map) => {
    map[entry.id] = entry;
  });
}

export async function removeSnoozedTab(id: string): Promise<void> {
  await updateMap<SnoozedTab>(SNOOZED_TABS_KEY, (map) => {
    delete map[id];
  });
}

/**
 * The tab each window most recently settled on, keyed by window id.
 *
 * Stored rather than held in memory because the thing that reads it is a
 * service worker, and an MV3 worker is unloaded after about thirty seconds
 * idle. A Map here survived only as long as the worker did: after every
 * unload the next activation saw no previous tab, counted as a first visit
 * rather than a revisit, and the count stopped moving.
 *
 * Per-window because each window has its own focus history — switching
 * windows is not a revisit within either of them.
 */
export type LastActiveTabMap = Record<number, number>;

export async function getLastActiveTabByWindow(): Promise<LastActiveTabMap> {
  return (await readMap<number>(LAST_ACTIVE_TAB_KEY)) as LastActiveTabMap;
}

export async function setLastActiveTab(windowId: number, tabId: number): Promise<void> {
  await updateMap<number>(LAST_ACTIVE_TAB_KEY, (map) => {
    map[windowId] = tabId;
  });
}

/** Drops a closed window, so the record doesn't accumulate dead window ids. */
export async function forgetWindow(windowId: number): Promise<void> {
  await updateMap<number>(LAST_ACTIVE_TAB_KEY, (map) => {
    delete map[windowId];
  });
}

/**
 * Follow a discarded tab onto its replacement id.
 *
 * Without this the window's last-active tab points at an id that no longer
 * exists, so returning to that same tab reads as a switch and counts a revisit
 * the user never made.
 */
export async function replaceLastActiveTab(
  removedTabId: number,
  addedTabId: number,
): Promise<void> {
  await updateMap<number>(LAST_ACTIVE_TAB_KEY, (map) => {
    for (const [windowId, tabId] of Object.entries(map)) {
      if (tabId === removedTabId) map[Number(windowId)] = addedTabId;
    }
  });
}

/**
 * Read and write access to one stored config object.
 *
 * Sanitized on *read*, not merely on write, because the write path isn't the
 * only way these keys change: a downgrade, a synced profile or a hand-edited
 * record can all leave something behind that never went through save.
 *
 * Saves are read-modify-write like the maps above — the settings form saves
 * one field at a time, and a whole-object write would race a second field
 * saved while the first was still in flight.
 */
function configAccessors<T extends object>(key: string, sanitize: (stored: unknown) => T) {
  const get = async (): Promise<T> => sanitize((await chrome.storage.local.get(key))[key]);

  return {
    get,
    save: async (patch: Partial<T>): Promise<void> => {
      await chrome.storage.local.set({ [key]: sanitize({ ...(await get()), ...patch }) });
    },
  };
}

const stalenessConfig = configAccessors(STALENESS_CONFIG_KEY, sanitizeStalenessConfig);

/** The user's scoring weights, always complete and always in range. */
export const getStalenessConfig = stalenessConfig.get;

/** Change some weights, leaving the rest alone. */
export const saveStalenessConfig = stalenessConfig.save;

const promptConfig = configAccessors(PROMPT_CONFIG_KEY, sanitizePromptConfig);

/** The daily prompt's settings, sanitized on read like the weights. */
export const getPromptConfig = promptConfig.get;

export const savePromptConfig = promptConfig.save;

/**
 * When the prompt was last shown, and when this browser session began.
 *
 * Stored rather than held in the worker for the usual reason — the worker is
 * unloaded between alarms — but also because both have to outlive it by
 * design: a daily interval means nothing if the record of the last prompt
 * dies every thirty seconds.
 */
export interface PromptState {
  lastPromptedAt: number;
  sessionStartedAt: number;
}

export async function getPromptState(): Promise<PromptState> {
  const result = await chrome.storage.local.get(PROMPT_STATE_KEY);
  const stored = result[PROMPT_STATE_KEY] as Partial<PromptState> | undefined;

  return {
    // Zero, not the current time: a profile that has never been prompted is
    // due for one, and seeding it with "now" would suppress the first prompt
    // for a day for no reason.
    lastPromptedAt: numberOr(stored?.lastPromptedAt, 0),
    // Now, not zero: with no recorded session start, the grace period should
    // apply rather than be skipped. Erring toward silence.
    sessionStartedAt: numberOr(stored?.sessionStartedAt, Date.now()),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function patchPromptState(patch: Partial<PromptState>): Promise<void> {
  await chrome.storage.local.set({ [PROMPT_STATE_KEY]: { ...(await getPromptState()), ...patch } });
}

export async function setLastPromptedAt(at: number): Promise<void> {
  await patchPromptState({ lastPromptedAt: at });
}

export async function setSessionStartedAt(at: number): Promise<void> {
  await patchPromptState({ sessionStartedAt: at });
}

/**
 * Back to the defaults.
 *
 * Writes them out rather than removing the key, so the change is visible to
 * chrome.storage.onChanged — a removal would leave every listener that reads
 * `changes.stalenessConfig.newValue` seeing undefined and re-ranking to
 * nothing.
 */
export async function resetStalenessConfig(): Promise<void> {
  await chrome.storage.local.set({ [STALENESS_CONFIG_KEY]: { ...DEFAULT_STALENESS_CONFIG } });
}
