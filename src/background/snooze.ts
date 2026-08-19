/**
 * Snoozing: close a tab now, reopen it later.
 *
 * The stored entry is the source of truth and the alarm is only a trigger.
 * That ordering matters — alarms don't survive every extension lifecycle
 * event (an update, a crash, a disable/enable round trip can drop them) while
 * chrome.storage.local does, so a lost alarm is recoverable and a lost entry
 * is a tab the user never gets back.
 */

import type { SnoozeTabResponse } from '../shared/messages';
import {
  MAX_SNOOZE_MS,
  MIN_SNOOZE_MS,
  snoozeAlarmName,
  snoozeIdFromAlarm,
} from '../shared/snooze';
import {
  addSnoozedTab,
  getSnoozedTabs,
  getTabActivityMap,
  removeSnoozedTab,
  setTabActivity,
} from '../shared/storage';
import type { SnoozedTab } from '../shared/types';

/**
 * Record a tab, schedule its return, then close it.
 *
 * The duration is re-validated here rather than trusted from the caller: the
 * side panel already parses it, but this runs on a message, and an
 * out-of-range value would either fire immediately or never.
 */
export async function snoozeTab(tabId: number, durationMs: number): Promise<SnoozeTabResponse> {
  if (!Number.isFinite(durationMs) || durationMs < MIN_SNOOZE_MS || durationMs > MAX_SNOOZE_MS) {
    return { status: 'failed' };
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { status: 'failed' };
  }

  const url = tab.url?.trim();
  // Without a URL there's nothing to reopen, so closing the tab would simply
  // destroy it.
  if (!url) return { status: 'failed' };

  const now = Date.now();
  // Read before the tab closes: onRemoved prunes this entry, so the idle clock
  // is only available up to this point.
  const tracked = (await getTabActivityMap())[tabId];

  const entry: SnoozedTab = {
    id: crypto.randomUUID(),
    url,
    title: tab.title?.trim() || url,
    faviconUrl: tab.favIconUrl?.trim() || undefined,
    snoozedAt: now,
    wakeAt: now + durationMs,
    // A tab can be snoozed before it has dwelled long enough to be tracked, in
    // which case there is no history to carry and the snooze itself is the
    // most recent thing that happened to it.
    lastActiveAt: tracked?.lastActiveAt ?? now,
    revisitCount: tracked?.revisitCount ?? 0,
  };

  // Written and scheduled before the tab is touched. A failure here leaves the
  // tab open, which is recoverable; a tab closed against a failed write is not.
  try {
    await addSnoozedTab(entry);
    await chrome.alarms.create(snoozeAlarmName(entry.id), { when: entry.wakeAt });
  } catch (error) {
    console.error('[Tabbatical] Failed to schedule a snooze', error);
    // Roll back so a half-written snooze doesn't strand an entry with no alarm
    // for a tab that's still open — reconcile would "wake" it into a duplicate.
    try {
      await removeSnoozedTab(entry.id);
    } catch (cleanupError) {
      console.error('[Tabbatical] Failed to roll back a snooze entry', cleanupError);
    }
    return { status: 'failed' };
  }

  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // The snooze is already safe. A tab that refused to close will produce a
    // second copy at wake time, which is a far smaller problem than dropping
    // the schedule for a tab the user has mentally already put away.
    console.warn('[Tabbatical] Snoozed, but could not close the tab', error);
  }

  // Closing the tab fires onRemoved, which prunes the tracking map and
  // re-renders the digest through the storage listener.
  return { status: 'snoozed', wakeAt: entry.wakeAt };
}

/** Reopen a snoozed tab in the background and drop its record. */
export async function wakeSnoozedTab(id: string): Promise<void> {
  const entry = (await getSnoozedTabs())[id];
  // Already woken, or cancelled while the alarm was in flight.
  if (!entry) return;

  let created: chrome.tabs.Tab;
  try {
    // Inactive: a tab surfacing on a timer must not steal focus from whatever
    // the user is actually doing.
    created = await chrome.tabs.create({ url: entry.url, active: false });
  } catch (error) {
    // Deliberately kept in storage. This entry is the only record of the page,
    // so discarding it on a failed reopen would lose it outright — whereas
    // leaving it means reconcileSnoozes retries at the next startup, by which
    // point the usual cause (no window open yet) has gone away.
    console.error('[Tabbatical] Failed to reopen a snoozed tab', error);
    return;
  }

  // Tracked explicitly, because nothing else would do it. A background tab
  // fires no onActivated, and the onUpdated listener refuses to create entries
  // so that a tab the user just opened doesn't jump straight into the digest.
  // A woken tab is the opposite case: it's a deferral coming due, and a snooze
  // that returns a tab into invisibility defeats the point of snoozing.
  if (created?.id != null) {
    try {
      await setTabActivity({
        tabId: created.id,
        url: entry.url,
        title: entry.title,
        // Restores the clock from before the snooze, so the digest ranks it as
        // the deferral it is rather than as a brand-new tab.
        lastActiveAt: entry.lastActiveAt ?? entry.snoozedAt,
        revisitCount: entry.revisitCount ?? 0,
        groupId: null,
        pinned: false,
      });
    } catch (error) {
      // Not fatal, and deliberately not a reason to keep the entry: the tab is
      // already back, and leaving the record would reopen it a second time.
      // initializeExistingTabs picks it up at the next startup.
      console.error('[Tabbatical] Reopened a snoozed tab but could not track it', error);
    }
  }

  await forgetSnooze(id);
}

/**
 * Drop a snooze without reopening the tab.
 *
 * Strictly more destructive than deleting an archive entry: nothing was
 * captured, so the record is the last trace of the page. The confirmation is
 * the caller's job.
 */
export async function cancelSnooze(id: string): Promise<void> {
  await forgetSnooze(id);
}

/**
 * Clear both halves of a snooze.
 *
 * The alarm has to go with the entry. On the normal path it has already fired
 * and clearing is a no-op, but waking early or cancelling leaves it scheduled
 * with nothing behind it — individually harmless, since the handler no-ops on
 * a missing entry, but they accumulate in the alarm list.
 */
async function forgetSnooze(id: string): Promise<void> {
  await removeSnoozedTab(id);
  try {
    await chrome.alarms.clear(snoozeAlarmName(id));
  } catch (error) {
    console.error('[Tabbatical] Failed to clear a snooze alarm', error);
  }
}

/** Routes an alarm to its snooze, ignoring alarms that belong to other features. */
export async function handleSnoozeAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  const id = snoozeIdFromAlarm(alarm.name);
  if (!id) return;
  await wakeSnoozedTab(id);
}

/**
 * Bring alarms back in line with stored snoozes, on install and startup.
 *
 * Covers the two ways a snooze goes quiet: an alarm dropped by an extension
 * update or crash (rebuilt from the entry), and a wake time that passed while
 * the browser was closed. Chrome does usually fire an overdue alarm shortly
 * after startup, but not when the extension was disabled or updated across
 * that window — and a tab that silently never comes back is the one failure
 * this feature can't afford.
 */
export async function reconcileSnoozes(now: number = Date.now()): Promise<void> {
  const entries = Object.values(await getSnoozedTabs());

  for (const entry of entries) {
    if (entry.wakeAt <= now) {
      await wakeSnoozedTab(entry.id);
      continue;
    }

    const name = snoozeAlarmName(entry.id);
    if (!(await chrome.alarms.get(name))) {
      await chrome.alarms.create(name, { when: entry.wakeAt });
    }
  }
}
