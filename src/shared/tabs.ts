/**
 * Looking up open tabs by their URL.
 *
 * The archive needs this to tell the truth about itself: an archived page that
 * is also open right now is in two places, and a row that doesn't say so
 * invites the user to restore a page they are already looking at.
 */

/**
 * Every open tab, keyed by URL.
 *
 * Matched exactly rather than normalized. Both sides of the comparison come
 * from `chrome.tabs.Tab.url`, which Chrome has already normalized, so the
 * usual trailing-slash mismatch can't arise — and loosening it would collapse
 * distinct pages that differ only in a query string or fragment, which is
 * wrong far more often than it is helpful.
 *
 * When the same URL is open more than once, the first wins. Which duplicate a
 * user gets sent to is arbitrary either way, and picking one keeps this a
 * plain map.
 */
export async function getOpenTabsByUrl(): Promise<Map<string, chrome.tabs.Tab>> {
  const byUrl = new Map<string, chrome.tabs.Tab>();

  try {
    for (const tab of await chrome.tabs.query({})) {
      const url = tab.url?.trim();
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, tab);
    }
  } catch (error) {
    // A failed lookup should cost the "open" marker, not the whole view.
    console.error('[Tabbatical] Could not read the open tabs', error);
  }

  return byUrl;
}

/**
 * Bring an existing tab to the front, window and all.
 *
 * Focusing the tab without focusing its window would "succeed" invisibly
 * whenever the tab is in a background window, which is exactly when the user
 * most needs to be taken there.
 */
export async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id != null) await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
}

/**
 * Go to a URL, using the tab that already has it rather than opening another.
 *
 * Both callers reach this from something the user could plausibly click twice
 * — an archive row and a notification that offers the same action in two
 * places — and a second copy of a page is precisely the mess this extension
 * exists to clear up.
 *
 * The lookup is a live query rather than anything remembered: the service
 * worker forgets state on its next unload, and a panel's snapshot goes stale
 * while the user reads the row. Errors propagate, because one caller reports
 * them on the row that failed and the other logs them.
 */
export async function openOrFocusTab(url: string): Promise<void> {
  const [existing] = await chrome.tabs.query({ url });
  await focusTab(existing ?? (await chrome.tabs.create({ url })));
}
