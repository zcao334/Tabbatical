/**
 * The daily review prompt.
 *
 * The badge waits to be noticed, which works until the number becomes part of
 * the furniture. This is the part that initiates — and because it interrupts,
 * every path here errs toward saying nothing rather than saying it twice.
 */

import {
  promptBatchFor,
  promptMessage,
  shouldPrompt,
} from '../shared/prompt';
import { countDueForReview, scoreTrackedTabs } from '../shared/review';
import { getPromptConfig, getPromptState, setLastPromptedAt } from '../shared/storage';

/**
 * A fixed id, so there is only ever one prompt outstanding. Chrome would
 * otherwise queue them, and a column of identical notifications is the exact
 * thing that gets an extension muted.
 *
 * See the clear() in maybePromptReview: a fixed id alone is not enough, and is
 * actively harmful without it.
 */
const NOTIFICATION_ID = 'tabbatical:review-prompt';

const REVIEW_BUTTON = 0;

/** Where the click lands if the side panel can't be opened programmatically. */
const PANEL_PATH = 'src/sidepanel/index.html';

/**
 * Fire the prompt if this is the moment for it.
 *
 * Called from the review alarm rather than an alarm of its own: a daily alarm
 * can't fire while Chrome is closed, so it would drift by however long the
 * browser was shut, and a fixed hour fires while the user is asleep. Checking
 * a condition on the half-hourly tick means the prompt lands on the first use
 * of the day instead.
 */
export async function maybePromptReview(now: number = Date.now()): Promise<void> {
  try {
    const [config, state] = await Promise.all([getPromptConfig(), getPromptState()]);
    const dueCount = countDueForReview(await scoreTrackedTabs(now));

    if (!shouldPrompt({ now, dueCount, config, ...state })) return;

    // Recorded *before* the notification is created, and regardless of whether
    // creating it succeeds. If this came after, a failure here would leave the
    // timestamp untouched and the next tick would try again thirty minutes
    // later — turning one prompt a day into a prompt every half hour.
    await setLastPromptedAt(now);

    // Retract yesterday's prompt before posting today's, even though the id
    // is the same. Creating with an id that is still in the notification
    // centre *updates it silently* rather than announcing it — so a user who
    // never dismissed the last one would simply stop being told, which is the
    // one failure this whole feature exists to avoid. Clearing first costs an
    // API call and turns a silent update into a real alert.
    // Failing to retract is not a reason to stay silent: lastPromptedAt is
    // already written, so bailing here would cost the user the whole day's
    // prompt over a notification that may not even have existed.
    try {
      await chrome.notifications.clear(NOTIFICATION_ID);
    } catch (error) {
      console.warn('[Tabbatical] Could not retract the previous prompt', error);
    }

    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/icons/icon128.png'),
      title: 'Time for a tab review',
      message: promptMessage(dueCount, config),
      buttons: [{ title: `Review ${promptBatchFor(dueCount, config)}` }, { title: 'Not today' }],
      // Left to time out on its own. Requiring interaction would make the
      // notification something to be dealt with, and ignoring it has to stay
      // a valid answer.
      requireInteraction: false,
    });
  } catch (error) {
    console.error('[Tabbatical] Failed to show the review prompt', error);
  }
}

/**
 * Open the review surface.
 *
 * Tries the side panel first, since that's where the digest lives and it keeps
 * the user's tab strip alone. sidePanel.open() needs a user gesture, and
 * whether a notification click counts as one is undocumented — so the tab is
 * not a fallback for failure so much as the other half of a coin flip, and it
 * has to be as good an outcome.
 */
export async function openReview(): Promise<void> {
  try {
    const window = await chrome.windows.getLastFocused();
    if (window.id != null) {
      await chrome.sidePanel.open({ windowId: window.id });
      return;
    }
  } catch (error) {
    console.warn('[Tabbatical] Could not open the side panel from a notification', error);
  }

  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(PANEL_PATH) });
  } catch (error) {
    console.error('[Tabbatical] Could not open the review tab either', error);
  }
}

/** Clicking the notification body opens the review, same as the button. */
export async function handleNotificationClick(notificationId: string): Promise<void> {
  if (notificationId !== NOTIFICATION_ID) return;
  await chrome.notifications.clear(NOTIFICATION_ID);
  await openReview();
}

/**
 * "Review" opens the digest; "Not today" just clears.
 *
 * Dismissing needs no bookkeeping — the timestamp was already written when the
 * prompt was shown, so ignoring it and declining it suppress the next one
 * equally. That's deliberate: a user who ignores the prompt has answered it.
 */
export async function handleNotificationButton(
  notificationId: string,
  buttonIndex: number,
): Promise<void> {
  if (notificationId !== NOTIFICATION_ID) return;
  await chrome.notifications.clear(NOTIFICATION_ID);
  if (buttonIndex === REVIEW_BUTTON) await openReview();
}
