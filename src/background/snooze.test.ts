import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSnooze,
  handleSnoozeAlarm,
  reconcileSnoozes,
  snoozeTab,
  wakeSnoozedTab,
} from './snooze';
import { MAX_SNOOZE_MS, MIN_SNOOZE_MS, snoozeAlarmName } from '../shared/snooze';
import { addSnoozedTab, getSnoozedTabs, getTabActivityMap, setTabActivity } from '../shared/storage';
import type { SnoozedTab } from '../shared/types';

const NOW = new Date('2026-08-18T09:00:00Z').getTime();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let store: Record<string, unknown> = {};
let openTabs: Record<number, chrome.tabs.Tab> = {};
let scheduled: Record<string, { name: string; scheduledTime: number }> = {};

const tabsCreate = vi.fn(
  async (_props: chrome.tabs.CreateProperties) => ({ id: 99 }) as chrome.tabs.Tab,
);
const tabsRemove = vi.fn(async (tabId: number) => {
  delete openTabs[tabId];
});
const alarmsClear = vi.fn(async (name: string) => {
  const existed = name in scheduled;
  delete scheduled[name];
  return existed;
});
const alarmsCreate = vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
  scheduled[name] = { name, scheduledTime: info.when ?? 0 };
});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
  tabs: {
    get: async (tabId: number) => {
      const tab = openTabs[tabId];
      if (!tab) throw new Error(`No tab with id ${tabId}`);
      return tab;
    },
    create: tabsCreate,
    remove: tabsRemove,
  },
  alarms: {
    create: alarmsCreate,
    get: async (name: string) => scheduled[name],
    clear: alarmsClear,
  },
});

function openTab(tabId: number, overrides: Partial<chrome.tabs.Tab> = {}): void {
  openTabs[tabId] = {
    id: tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    favIconUrl: 'https://example.com/favicon.ico',
    ...overrides,
  } as chrome.tabs.Tab;
}

function snoozed(overrides: Partial<SnoozedTab> = {}): SnoozedTab {
  return {
    id: 'entry-1',
    url: 'https://example.com/saved',
    title: 'Saved',
    snoozedAt: NOW - HOUR,
    wakeAt: NOW + DAY,
    ...overrides,
  };
}

const entriesIn = async () => Object.values(await getSnoozedTabs());

beforeEach(() => {
  store = {};
  openTabs = {};
  scheduled = {};
  vi.clearAllMocks();
  tabsCreate.mockResolvedValue({ id: 99 } as chrome.tabs.Tab);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('snoozeTab', () => {
  it('records the tab, schedules its return, then closes it', async () => {
    openTab(7);

    const response = await snoozeTab(7, DAY);

    expect(response).toEqual({ status: 'snoozed', wakeAt: NOW + DAY });

    const [entry] = await entriesIn();
    expect(entry).toMatchObject({
      url: 'https://example.com/7',
      title: 'Tab 7',
      faviconUrl: 'https://example.com/favicon.ico',
      wakeAt: NOW + DAY,
    });
    expect(scheduled[snoozeAlarmName(entry.id)].scheduledTime).toBe(NOW + DAY);
    expect(tabsRemove).toHaveBeenCalledWith(7);
  });

  it('schedules the return before closing the tab', async () => {
    // A tab closed against a failed write is the one unrecoverable failure
    // here, so the ordering is the guarantee worth pinning down.
    openTab(7);
    const order: string[] = [];
    alarmsCreate.mockImplementationOnce(async (name, info) => {
      order.push('schedule');
      scheduled[name] = { name, scheduledTime: info.when ?? 0 };
    });
    tabsRemove.mockImplementationOnce(async () => {
      order.push('close');
    });

    await snoozeTab(7, DAY);

    expect(order).toEqual(['schedule', 'close']);
  });

  it('gives the tab a stable id of its own rather than reusing the tab id', async () => {
    // Chrome recycles tab ids, and this record outlives the browser session.
    openTab(7);
    await snoozeTab(7, DAY);
    openTab(7);
    await snoozeTab(7, DAY);

    const entries = await entriesIn();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('refuses a duration outside the schedulable range, leaving the tab open', async () => {
    openTab(7);

    expect(await snoozeTab(7, MIN_SNOOZE_MS - 1)).toEqual({ status: 'failed' });
    expect(await snoozeTab(7, MAX_SNOOZE_MS + 1)).toEqual({ status: 'failed' });
    expect(await snoozeTab(7, Number.NaN)).toEqual({ status: 'failed' });

    expect(await entriesIn()).toHaveLength(0);
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it('refuses a tab with no URL, since there would be nothing to reopen', async () => {
    openTab(7, { url: '' });

    expect(await snoozeTab(7, DAY)).toEqual({ status: 'failed' });
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it('fails on a tab that is already gone', async () => {
    expect(await snoozeTab(404, DAY)).toEqual({ status: 'failed' });
    expect(await entriesIn()).toHaveLength(0);
  });

  it('rolls the entry back when scheduling fails, and keeps the tab open', async () => {
    // An entry with no alarm for a tab that is still open would be "woken"
    // into a duplicate at the next reconcile.
    openTab(7);
    alarmsCreate.mockRejectedValueOnce(new Error('alarm quota'));

    expect(await snoozeTab(7, DAY)).toEqual({ status: 'failed' });
    expect(await entriesIn()).toHaveLength(0);
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it('keeps the snooze when the tab refuses to close', async () => {
    openTab(7);
    tabsRemove.mockRejectedValueOnce(new Error('cannot close'));

    expect(await snoozeTab(7, DAY)).toMatchObject({ status: 'snoozed' });
    expect(await entriesIn()).toHaveLength(1);
  });

  it('carries the idle clock across the snooze', async () => {
    // Snoozing is a deferral, not a visit, so the tab must not come back
    // looking freshly used.
    openTab(7);
    await setTabActivity({
      tabId: 7,
      url: 'https://example.com/7',
      title: 'Tab 7',
      lastActiveAt: NOW - 5 * DAY,
      revisitCount: 4,
      groupId: null,
      pinned: false,
    });

    await snoozeTab(7, DAY);

    const [entry] = await entriesIn();
    expect(entry.lastActiveAt).toBe(NOW - 5 * DAY);
    expect(entry.revisitCount).toBe(4);
  });

  it('has something to carry even for a tab that was never tracked', async () => {
    // A tab can be snoozed before it dwells long enough to be tracked.
    openTab(7);

    await snoozeTab(7, DAY);

    const [entry] = await entriesIn();
    expect(entry.lastActiveAt).toBe(NOW);
    expect(entry.revisitCount).toBe(0);
  });

  it('falls back to the URL when the tab has no title', async () => {
    openTab(7, { title: '   ' });
    await snoozeTab(7, DAY);

    const [entry] = await entriesIn();
    expect(entry.title).toBe('https://example.com/7');
  });
});

describe('wakeSnoozedTab', () => {
  it('reopens the page without stealing focus, and clears the record', async () => {
    await addSnoozedTab(snoozed());

    await wakeSnoozedTab('entry-1');

    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/saved', active: false });
    expect(await entriesIn()).toHaveLength(0);
  });

  it('keeps the record when reopening fails', async () => {
    // The record is the only remaining trace of the page; dropping it on a
    // failed reopen would lose it outright.
    await addSnoozedTab(snoozed());
    tabsCreate.mockRejectedValueOnce(new Error('no window'));

    await wakeSnoozedTab('entry-1');

    expect(await entriesIn()).toHaveLength(1);
  });

  it('puts the reopened tab straight into the digest', async () => {
    // Nothing else would: a background tab fires no onActivated, and the
    // onUpdated listener refuses to create entries.
    await addSnoozedTab(snoozed({ lastActiveAt: NOW - 5 * DAY, revisitCount: 4 }));

    await wakeSnoozedTab('entry-1');

    const tracked = (await getTabActivityMap())[99];
    expect(tracked).toMatchObject({
      tabId: 99,
      url: 'https://example.com/saved',
      title: 'Saved',
      lastActiveAt: NOW - 5 * DAY,
      revisitCount: 4,
    });
  });

  it('dates a legacy entry from its snooze time', async () => {
    // Entries written before carry-over landed have no clock to restore.
    const legacy = snoozed();
    delete legacy.lastActiveAt;
    delete legacy.revisitCount;
    await addSnoozedTab(legacy);

    await wakeSnoozedTab('entry-1');

    expect((await getTabActivityMap())[99]).toMatchObject({
      lastActiveAt: legacy.snoozedAt,
      revisitCount: 0,
    });
  });

  it('does not track anything when the reopen yields no tab id', async () => {
    await addSnoozedTab(snoozed());
    tabsCreate.mockResolvedValueOnce({} as chrome.tabs.Tab);

    await wakeSnoozedTab('entry-1');

    expect(await getTabActivityMap()).toEqual({});
    expect(await entriesIn()).toHaveLength(0);
  });

  it('still clears the record when tracking fails, so it cannot reopen twice', async () => {
    await addSnoozedTab(snoozed());
    const set = chrome.storage.local.set;
    chrome.storage.local.set = (async (items: Record<string, unknown>) => {
      if (items.tabActivityMap) throw new Error('storage full');
      return set(items);
    }) as typeof chrome.storage.local.set;

    await wakeSnoozedTab('entry-1');
    chrome.storage.local.set = set;

    expect(await entriesIn()).toHaveLength(0);
  });

  it('clears the alarm, so waking early leaves nothing scheduled', async () => {
    // On the normal path the alarm has already fired and this is a no-op; it
    // matters when the user opens the tab ahead of time.
    await addSnoozedTab(snoozed());
    scheduled[snoozeAlarmName('entry-1')] = {
      name: snoozeAlarmName('entry-1'),
      scheduledTime: NOW + DAY,
    };

    await wakeSnoozedTab('entry-1');

    expect(scheduled).toEqual({});
  });

  it('does nothing for an id that is no longer stored', async () => {
    await wakeSnoozedTab('gone');
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});

describe('handleSnoozeAlarm', () => {
  it('wakes the tab named by the alarm', async () => {
    await addSnoozedTab(snoozed());

    await handleSnoozeAlarm({ name: snoozeAlarmName('entry-1') } as chrome.alarms.Alarm);

    expect(tabsCreate).toHaveBeenCalledOnce();
  });

  it('ignores alarms that belong to other features', async () => {
    await addSnoozedTab(snoozed());

    await handleSnoozeAlarm({ name: 'tabbatical:review' } as chrome.alarms.Alarm);

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(await entriesIn()).toHaveLength(1);
  });
});

describe('reconcileSnoozes', () => {
  it('wakes anything whose time passed while the browser was closed', async () => {
    await addSnoozedTab(snoozed({ id: 'overdue', wakeAt: NOW - HOUR }));

    await reconcileSnoozes(NOW);

    expect(tabsCreate).toHaveBeenCalledOnce();
    expect(await entriesIn()).toHaveLength(0);
  });

  it('rebuilds an alarm that was dropped', async () => {
    // Alarms don't survive every extension update; the stored entry does, so
    // it is what the schedule gets rebuilt from.
    await addSnoozedTab(snoozed({ id: 'future', wakeAt: NOW + DAY }));

    await reconcileSnoozes(NOW);

    expect(scheduled[snoozeAlarmName('future')].scheduledTime).toBe(NOW + DAY);
  });

  it('leaves an alarm that is already set alone', async () => {
    await addSnoozedTab(snoozed({ id: 'future', wakeAt: NOW + DAY }));
    scheduled[snoozeAlarmName('future')] = {
      name: snoozeAlarmName('future'),
      scheduledTime: NOW + DAY,
    };

    await reconcileSnoozes(NOW);

    expect(alarmsCreate).not.toHaveBeenCalled();
  });

  it('handles a mix without letting one entry affect another', async () => {
    await addSnoozedTab(snoozed({ id: 'overdue', wakeAt: NOW - HOUR }));
    await addSnoozedTab(snoozed({ id: 'future', wakeAt: NOW + DAY }));

    await reconcileSnoozes(NOW);

    const remaining = await entriesIn();
    expect(remaining.map((entry) => entry.id)).toEqual(['future']);
    expect(scheduled[snoozeAlarmName('future')]).toBeDefined();
  });

  it('does nothing when there is nothing snoozed', async () => {
    await reconcileSnoozes(NOW);

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(alarmsCreate).not.toHaveBeenCalled();
  });
});

describe('cancelSnooze', () => {
  it('drops the record without reopening the tab', async () => {
    await addSnoozedTab(snoozed());

    await cancelSnooze('entry-1');

    expect(await entriesIn()).toHaveLength(0);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('clears the alarm, so a cancelled snooze cannot fire later', async () => {
    await addSnoozedTab(snoozed());
    scheduled[snoozeAlarmName('entry-1')] = {
      name: snoozeAlarmName('entry-1'),
      scheduledTime: NOW + DAY,
    };

    await cancelSnooze('entry-1');

    expect(scheduled).toEqual({});
  });

  it('leaves other snoozes alone', async () => {
    await addSnoozedTab(snoozed({ id: 'a' }));
    await addSnoozedTab(snoozed({ id: 'b' }));

    await cancelSnooze('a');

    expect((await entriesIn()).map((entry) => entry.id)).toEqual(['b']);
  });

  it('is harmless on an id that is already gone', async () => {
    await expect(cancelSnooze('gone')).resolves.toBeUndefined();
  });
});

describe('an alarm that outlives its entry', () => {
  it('reopens nothing', async () => {
    // The belt to forgetSnooze's braces: even if an orphan alarm survives, the
    // handler must not resurrect a tab the user cancelled.
    await addSnoozedTab(snoozed());
    await cancelSnooze('entry-1');

    await handleSnoozeAlarm({ name: snoozeAlarmName('entry-1') } as chrome.alarms.Alarm);

    expect(tabsCreate).not.toHaveBeenCalled();
  });
});
