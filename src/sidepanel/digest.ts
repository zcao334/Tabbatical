import { computeStaleness } from '../shared/staleness';
import { getTabActivityMap, patchTabActivity } from '../shared/storage';
import type { TabActivity } from '../shared/types';
import { isInjectableUrl, requestHostPermission } from '../shared/permissions';
import {
  ARCHIVE_TAB_REQUEST,
  type ArchiveTabRequest,
  type ArchiveTabResponse,
} from '../shared/messages';
import { createEntryRow, createRenderGuard, renderEmptyState } from './components';

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
  const { activity } = entry;
  const archiving = archivingTabIds.has(activity.tabId);

  return createEntryRow({
    title: activity.title || activity.url,
    meta: `${formatDaysIdle(activity.lastActiveAt)} · revisited ${activity.revisitCount}x · score ${entry.staleness.toFixed(0)}`,
    error: failedTabIds.has(activity.tabId) ? "Couldn't archive" : undefined,
    actions: [
      { label: 'Keep', onClick: () => actions.onKeep(activity.tabId) },
      {
        label: archiving ? 'Archiving…' : 'Archive',
        disabled: archiving,
        onClick: () => actions.onArchive(activity),
      },
    ],
  });
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

// A manual re-render after "Keep" races the chrome.storage.onChanged listener
// firing for the same write, so renders overlap routinely.
const renderGuard = createRenderGuard();

export async function renderDigest(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();
  const entries = await buildDigest();
  if (!isCurrent()) return;

  if (entries.length === 0) {
    renderEmptyState(container, 'No tracked tabs yet.');
    return;
  }

  container.innerHTML = '';

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
