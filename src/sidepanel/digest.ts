import { computeStaleness } from '../shared/staleness';
import { getTabActivityMap, patchTabActivity } from '../shared/storage';
import type { TabActivity } from '../shared/types';
import { isInjectableUrl, requestHostPermission } from '../shared/permissions';
import {
  ARCHIVE_TAB_REQUEST,
  type ArchiveTabRequest,
  type ArchiveTabResponse,
} from '../shared/messages';

interface DigestEntry {
  activity: TabActivity;
  staleness: number;
}

async function getActiveGroupIds(): Promise<Set<number>> {
  const groups = await chrome.tabGroups.query({ collapsed: false });
  return new Set(groups.map((group) => group.id));
}

async function buildDigest(): Promise<DigestEntry[]> {
  const [map, activeGroupIds] = await Promise.all([getTabActivityMap(), getActiveGroupIds()]);
  const now = Date.now();

  return Object.values(map)
    .map((activity) => ({
      activity,
      staleness: computeStaleness(
        {
          lastActiveAt: activity.lastActiveAt,
          revisitCount: activity.revisitCount,
          pinned: activity.pinned,
          isInActiveGroup: activity.groupId != null && activeGroupIds.has(activity.groupId),
        },
        now,
      ),
    }))
    .sort((a, b) => b.staleness - a.staleness);
}

function formatDaysIdle(lastActiveAt: number): string {
  const days = (Date.now() - lastActiveAt) / (1000 * 60 * 60 * 24);
  if (days < 1) return 'active today';
  return `${Math.floor(days)}d idle`;
}

interface EntryActions {
  onKeep: (tabId: number) => void;
  onArchive: (activity: TabActivity) => void;
}

function renderEntry(entry: DigestEntry, actions: EntryActions): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'tab-item';

  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = entry.activity.title || entry.activity.url;
  info.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'tab-meta';
  meta.textContent = `${formatDaysIdle(entry.activity.lastActiveAt)} · revisited ${entry.activity.revisitCount}x · score ${entry.staleness.toFixed(0)}`;
  info.appendChild(meta);

  li.appendChild(info);

  const keepButton = document.createElement('button');
  keepButton.className = 'keep-button';
  keepButton.textContent = 'Keep';
  keepButton.addEventListener('click', () => actions.onKeep(entry.activity.tabId));
  li.appendChild(keepButton);

  const archiveButton = document.createElement('button');
  archiveButton.className = 'archive-button';
  const archiving = archivingTabIds.has(entry.activity.tabId);
  archiveButton.textContent = archiving ? 'Archiving…' : 'Archive';
  archiveButton.disabled = archiving;
  archiveButton.addEventListener('click', () => actions.onArchive(entry.activity));
  li.appendChild(archiveButton);

  if (failedTabIds.has(entry.activity.tabId)) {
    const error = document.createElement('div');
    error.className = 'tab-error';
    error.textContent = "Couldn't archive";
    li.appendChild(error);
  }

  return li;
}

/**
 * In-flight and failed state lives outside the DOM because renderDigest()
 * rebuilds the whole list — and archiving triggers storage writes that cause
 * exactly such a re-render, which would otherwise wipe a button's disabled
 * state mid-operation.
 */
const archivingTabIds = new Set<number>();
const failedTabIds = new Set<number>();

async function archiveTab(activity: TabActivity, container: HTMLElement): Promise<void> {
  if (archivingTabIds.has(activity.tabId)) return;

  // Requested first thing in the click handler, with no await ahead of it, so
  // the user gesture is still valid. Already-granted origins resolve without
  // prompting, so there's no need to check first. Non-http pages (chrome://)
  // skip this entirely and fall through to a metadata-only archive.
  if (isInjectableUrl(activity.url)) {
    const granted = await requestHostPermission(activity.url);
    if (!granted) return;
  }

  archivingTabIds.add(activity.tabId);
  failedTabIds.delete(activity.tabId);
  await renderDigest(container);

  let response: ArchiveTabResponse | undefined;
  try {
    response = await chrome.runtime.sendMessage<ArchiveTabRequest, ArchiveTabResponse>({
      type: ARCHIVE_TAB_REQUEST,
      tabId: activity.tabId,
    });
  } catch (error) {
    console.error('[Tab Review] Archive request failed', error);
  }

  archivingTabIds.delete(activity.tabId);
  if (response?.status === 'failed' || !response) {
    failedTabIds.add(activity.tabId);
  }

  // On success the tab closes, which prunes the tracking map and re-renders
  // via the storage listener; this covers the cancelled and failed paths.
  await renderDigest(container);
}

// Renders can overlap (a manual re-render after "Keep" races with the
// chrome.storage.onChanged listener firing for the same write). Since
// buildDigest() is async, an older render can otherwise resolve after a
// newer one and overwrite the DOM with stale data. Track the latest
// requested render and drop the result of any call that's been superseded.
let latestRenderId = 0;

export async function renderDigest(container: HTMLElement): Promise<void> {
  const renderId = ++latestRenderId;
  const entries = await buildDigest();
  if (renderId !== latestRenderId) return;

  container.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No tracked tabs yet.';
    container.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    container.appendChild(
      renderEntry(entry, {
        onKeep: async (tabId) => {
          await patchTabActivity(tabId, { lastActiveAt: Date.now() });
          await renderDigest(container);
        },
        onArchive: (activity) => void archiveTab(activity, container),
      }),
    );
  }
}
