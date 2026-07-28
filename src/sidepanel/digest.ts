import { computeStaleness } from '../shared/staleness';
import { getTabActivityMap, patchTabActivity } from '../shared/storage';
import type { TabActivity } from '../shared/types';

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

function renderEntry(entry: DigestEntry, onKeep: (tabId: number) => void): HTMLLIElement {
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
  keepButton.addEventListener('click', () => onKeep(entry.activity.tabId));
  li.appendChild(keepButton);

  return li;
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
      renderEntry(entry, async (tabId) => {
        await patchTabActivity(tabId, { lastActiveAt: Date.now() });
        await renderDigest(container);
      }),
    );
  }
}
