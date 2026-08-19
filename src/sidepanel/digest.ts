import { scoreTrackedTabs, type ScoredTab } from '../shared/review';
import { patchTabActivity } from '../shared/storage';
import { MS_PER_DAY, type TabActivity } from '../shared/types';
import { isInjectableUrl, requestHostPermission } from '../shared/permissions';
import {
  ARCHIVE_TAB_REQUEST,
  SNOOZE_TAB_REQUEST,
  type ArchiveTabRequest,
  type ArchiveTabResponse,
  type SnoozeTabRequest,
  type SnoozeTabResponse,
} from '../shared/messages';
import { SNOOZE_PRESETS, parseDuration } from '../shared/snooze';
import {
  createArmedRow,
  createEntryRow,
  createRenderGuard,
  createRowState,
  renderEmptyState,
  type RowAction,
  type RowOptions,
} from './components';

function formatDaysIdle(lastActiveAt: number): string {
  const days = (Date.now() - lastActiveAt) / MS_PER_DAY;
  if (days < 1) return 'active today';
  return `${Math.floor(days)}d idle`;
}

/** What a row is doing while it's busy. Shown on the row, so it reads as a label. */
type PendingVerb = 'Archiving…' | 'Snoozing…';

/** Tracks which tabs have an action in flight, which one, and which last failed. */
const rowState = createRowState<number, PendingVerb>();

/**
 * Which row is showing the snooze picker, and how far into it.
 *
 * Snooze needs a duration before it can do anything, and a side panel has no
 * room for a menu that floats. The picker takes over the row's buttons
 * instead: `presets` offers the one-click durations, `custom` swaps in a field.
 */
type SnoozeStage = 'presets' | 'custom';
const snoozeMenu = createArmedRow<number, SnoozeStage>();

/**
 * The custom-duration field.
 *
 * A form rather than a bare input so Enter submits for free, which is the only
 * way this gets used once the user knows it exists.
 */
function createDurationField(onSubmit: (durationMs: number) => void): HTMLElement {
  const form = document.createElement('form');
  form.className = 'row-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'row-input';
  input.placeholder = '30m, 2h, 3d, 1w';
  input.setAttribute('aria-label', 'Snooze duration');
  input.autocomplete = 'off';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'row-button';
  submit.textContent = 'Snooze';

  const hint = document.createElement('div');
  hint.className = 'row-hint';

  form.append(input, submit, hint);

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const durationMs = parseDuration(input.value);
    if (durationMs === null) {
      // Reported in place, deliberately without a re-render: rebuilding the
      // row would throw away what the user typed along with it.
      hint.textContent = 'Try 30m, 2h, 3d or 1w — from 1 minute up to a year.';
      input.focus();
      return;
    }

    onSubmit(durationMs);
  });

  // The field exists only because the user just asked for it, so it takes the
  // caret. Deferred because it isn't in the document until this row is.
  setTimeout(() => input.focus(), 0);

  return form;
}

function cancelAction(onClick: () => void): RowAction {
  return { label: 'Cancel', className: 'row-button row-button--quiet', onClick };
}

interface EntryActions {
  onKeep: (tabId: number) => void;
  onArchive: (activity: TabActivity) => void;
  onSnooze: (activity: TabActivity, durationMs: number) => void;
  onOpenSnooze: (tabId: number, stage: SnoozeStage) => void;
  onCloseSnooze: () => void;
}

function renderEntry(entry: ScoredTab, actions: EntryActions): HTMLLIElement {
  const { activity } = entry;
  const pending = rowState.pendingFor(activity.tabId);
  const stage = snoozeMenu.detailFor(activity.tabId);

  const options: RowOptions = {
    title: activity.title || activity.url,
    // Dropped while the picker is open. Four buttons leave the staleness line
    // no room at panel width, and the question on screen is "how long?", not
    // "how stale?" — the numbers are what the user already read to get here.
    meta: stage
      ? []
      : [
          formatDaysIdle(activity.lastActiveAt),
          `revisited ${activity.revisitCount}x`,
          `score ${entry.staleness.toFixed(0)}`,
        ],
    error: rowState.errorFor(activity.tabId),
  };

  if (rowState.isPending(activity.tabId)) {
    // Nothing to click mid-operation: every action on this row acts on a tab
    // that's about to close.
    options.actions = [{ label: pending ?? 'Working…', disabled: true, onClick: () => {} }];
  } else if (stage === 'custom') {
    options.control = createDurationField((durationMs) => actions.onSnooze(activity, durationMs));
    options.actions = [cancelAction(actions.onCloseSnooze)];
  } else if (stage === 'presets') {
    options.actions = [
      ...SNOOZE_PRESETS.map((preset) => ({
        label: preset.label,
        onClick: () => actions.onSnooze(activity, preset.ms),
      })),
      { label: 'Custom', onClick: () => actions.onOpenSnooze(activity.tabId, 'custom') },
      cancelAction(actions.onCloseSnooze),
    ];
  } else {
    options.actions = [
      { label: 'Keep', onClick: () => actions.onKeep(activity.tabId) },
      { label: 'Snooze', onClick: () => actions.onOpenSnooze(activity.tabId, 'presets') },
      { label: 'Archive', onClick: () => actions.onArchive(activity) },
    ];
  }

  return createEntryRow(options);
}

async function archiveTab(activity: TabActivity, container: HTMLElement): Promise<void> {
  if (rowState.isPending(activity.tabId)) return;

  // Requested first thing in the click handler, with no await ahead of it, so
  // the user gesture is still valid. Already-granted origins resolve without
  // prompting, so there's no need to check first. Non-http pages (chrome://)
  // skip this entirely and fall through to a metadata-only archive.
  if (isInjectableUrl(activity.url)) {
    const granted = await requestHostPermission(activity.url);
    if (!granted) return;
  }

  // On success the tab closes, which prunes the tracking map and re-renders via
  // the storage listener; the render here covers the failed path.
  await rowState.run(
    activity.tabId,
    async () => {
      const response = await chrome.runtime.sendMessage<ArchiveTabRequest, ArchiveTabResponse>({
        type: ARCHIVE_TAB_REQUEST,
        tabId: activity.tabId,
      });
      // A missing response means the worker went away mid-request, which is a
      // failure like any other rather than a silent success.
      if (!response || response.status === 'failed') {
        throw new Error(`Archive request returned ${response?.status ?? 'no response'}`);
      }
    },
    { errorMessage: "Couldn't archive", pending: 'Archiving…', render: () => renderDigest(container) },
  );
}

/**
 * Hands the tab to the service worker, which stores it, sets the alarm and
 * closes it. No host permission is involved — snoozing reads nothing off the
 * page, it only needs the URL the tracking map already has.
 */
async function snoozeTab(
  activity: TabActivity,
  durationMs: number,
  container: HTMLElement,
): Promise<void> {
  snoozeMenu.clear();

  await rowState.run(
    activity.tabId,
    async () => {
      const response = await chrome.runtime.sendMessage<SnoozeTabRequest, SnoozeTabResponse>({
        type: SNOOZE_TAB_REQUEST,
        tabId: activity.tabId,
        durationMs,
      });
      if (!response || response.status === 'failed') {
        throw new Error(`Snooze request returned ${response?.status ?? 'no response'}`);
      }
    },
    { errorMessage: "Couldn't snooze", pending: 'Snoozing…', render: () => renderDigest(container) },
  );
}

// A manual re-render after "Keep" races the chrome.storage.onChanged listener
// firing for the same write, so renders overlap routinely.
const renderGuard = createRenderGuard();

export async function renderDigest(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();
  const entries = await scoreTrackedTabs();
  if (!isCurrent()) return;

  // A tab closed while its picker was open would leave the picker armed on a
  // dead tab id — and Chrome reuses tab ids, so it would eventually reopen on
  // an unrelated row.
  if (!entries.some((entry) => snoozeMenu.isArmed(entry.activity.tabId))) snoozeMenu.clear();

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
        onSnooze: (activity, durationMs) => void snoozeTab(activity, durationMs, container),
        onOpenSnooze: (tabId, stage) => {
          snoozeMenu.arm(tabId, stage);
          void renderDigest(container);
        },
        onCloseSnooze: () => {
          snoozeMenu.clear();
          void renderDigest(container);
        },
      }),
    );
  }
}
