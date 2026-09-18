# Privacy Policy for Tabbatical

Last updated: September 18, 2026

Tabbatical does not collect, transmit, or sell any data. There is no server, no
analytics, and no network request of any kind. Everything the extension stores
stays in your browser on your machine.

## What it stores, and where

**Tab activity**, in `chrome.storage.local`. For each open tab: its URL, title,
tab id, group id, pinned state, when you last looked at it, and how many times
you have returned to it. This is what the staleness score is computed from.

**Archived pages**, in IndexedDB. When you archive a tab, the extension extracts
the page's readable text with Mozilla's Readability and saves it along with the
title and URL, so you can search it later. Pages it cannot read (`chrome://`
URLs, discarded tabs, sites you have not granted permission for) are saved as
title and URL only.

**Your settings**, in `chrome.storage.local`. Scoring weights, the daily prompt
toggle, and the review batch size.

**Snoozed tabs**, in `chrome.storage.local`. The URL, title, and wake time of
each tab you have snoozed.

None of this leaves your machine. `chrome.storage.local` is local to the device
and is not synced to your Google account.

## Permissions

- `tabs`: read tab URLs and titles, which is what staleness is scored on.
- `tabGroups`: detect whether a tab sits in a group you currently have open, so
  grouped tabs are pushed down the list.
- `storage` and `unlimitedStorage`: keep tracking data, settings, and archived
  page text on the device. Archived text can grow past the default quota.
- `alarms`: recompute the badge on a schedule and wake snoozed tabs.
- `notifications`: show the once-daily review prompt.
- `sidePanel`: show the extension's interface.
- `scripting`: inject the text extractor into a page when you archive it.
- Optional host permissions for `http://*/*` and `https://*/*`: read the page
  text of a site you archive. These are requested one site at a time, at the
  moment you click Archive, and never at install.

## Removing your data

Uninstalling the extension deletes everything it stored. Individual archived
pages can be deleted from the Archive view at any time.

## Contact

Open an issue at https://github.com/zcao334/Tabbatical/issues
