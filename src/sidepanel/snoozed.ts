import {
  SNOOZE_ACTION_REQUEST,
  type SnoozeActionRequest,
  type SnoozeActionResponse,
} from '../shared/messages';
import { getSnoozedTabs } from '../shared/storage';
import type { SnoozedTab } from '../shared/types';
import {
  createArmedRow,
  createEntryRow,
  createRenderGuard,
  createRowState,
  renderEmptyState,
} from './components';
import { DATE_TIME_FORMAT, formatWakeIn } from './time';

const renderGuard = createRenderGuard();

/** What a row is doing while it's busy. */
type PendingVerb = 'Opening…' | 'Cancelling…';
const rowState = createRowState<string, PendingVerb>();

/**
 * The row whose Cancel is armed, if any.
 *
 * Cancelling is the most destructive action in the extension: the tab is
 * already closed and, unlike an archive entry, nothing about the page was
 * captured — so this record is the last trace of it. Two clicks, same as the
 * archive's Delete.
 */
const armedCancel = createArmedRow<string>();

async function sendAction(action: 'wake' | 'cancel', id: string): Promise<void> {
  const response = await chrome.runtime.sendMessage<SnoozeActionRequest, SnoozeActionResponse>({
    type: SNOOZE_ACTION_REQUEST,
    action,
    id,
  });
  // A missing response means the worker went away mid-request, which is a
  // failure like any other rather than a silent success.
  if (!response || response.status === 'failed') {
    throw new Error(`Snooze ${action} returned ${response?.status ?? 'no response'}`);
  }
}

/** Brings a tab back before its alarm fires. The record and alarm both clear. */
async function openNow(entry: SnoozedTab, container: HTMLElement): Promise<void> {
  armedCancel.clear();
  await rowState.run(entry.id, () => sendAction('wake', entry.id), {
    errorMessage: "Couldn't reopen this tab",
    pending: 'Opening…',
    render: () => renderSnoozed(container),
  });
}

async function cancelEntry(entry: SnoozedTab, container: HTMLElement): Promise<void> {
  if (!armedCancel.isArmed(entry.id)) {
    armedCancel.arm(entry.id);
    void renderSnoozed(container);
    return;
  }

  armedCancel.clear();
  await rowState.run(entry.id, () => sendAction('cancel', entry.id), {
    errorMessage: "Couldn't cancel this snooze",
    pending: 'Cancelling…',
    render: () => renderSnoozed(container),
  });
}

function buildRow(entry: SnoozedTab, container: HTMLElement): HTMLLIElement {
  const busy = rowState.isPending(entry.id);
  const armed = armedCancel.isArmed(entry.id);

  const row = createEntryRow({
    title: entry.title,
    meta: formatWakeIn(entry.wakeAt),
    faviconUrl: entry.faviconUrl,
    error: rowState.errorFor(entry.id),
    actions: busy
      ? [{ label: rowState.pendingFor(entry.id) ?? 'Working…', disabled: true, onClick: () => {} }]
      : [
          { label: 'Open now', onClick: () => void openNow(entry, container) },
          {
            label: armed ? 'Cancel?' : 'Cancel',
            className: armed ? 'row-button row-button--danger' : undefined,
            onClick: () => void cancelEntry(entry, container),
          },
        ],
  });

  // Same tooltip shape as the archive: the full URL, which is what tells two
  // captures of one site apart, plus the exact time the row only approximates.
  row.title = `${entry.url}\nBack ${DATE_TIME_FORMAT.format(entry.wakeAt)}`;
  return row;
}

export async function renderSnoozed(container: HTMLElement): Promise<void> {
  const isCurrent = renderGuard.begin();

  let entries: SnoozedTab[];
  try {
    entries = Object.values(await getSnoozedTabs());
  } catch (error) {
    console.error('[Tabbatical] Failed to read snoozed tabs', error);
    if (isCurrent()) renderEmptyState(container, "Couldn't load snoozed tabs.");
    return;
  }

  if (!isCurrent()) return;

  // Soonest first: the useful question here is what comes back next, not what
  // was put away first.
  entries.sort((a, b) => a.wakeAt - b.wakeAt);

  // A row that woke on its own while the panel sat open would leave the
  // confirmation armed on an id that no longer exists.
  if (!entries.some((entry) => armedCancel.isArmed(entry.id))) armedCancel.clear();

  if (entries.length === 0) {
    renderEmptyState(container, 'Nothing snoozed. Snooze a tab from Review to park it for later.');
    return;
  }

  container.innerHTML = '';
  for (const entry of entries) {
    container.appendChild(buildRow(entry, container));
  }
}
