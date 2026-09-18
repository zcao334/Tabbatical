# Chrome Web Store listing

Paste-ready text for the developer dashboard. Keep in step with the README and
`PRIVACY.md` when either changes.

## Short description (132 char limit)

Scores your open tabs by how stale they are and asks once a day whether you want
to close a few. Keep, snooze, or archive.

## Detailed description

Most tab extensions wait for you to open them. That is the problem. You only
open a tab manager when you are already thinking about your tabs, which is the
one moment you do not need help. The rest of the time the pile just grows.

Tabbatical starts the conversation instead. It scores your open tabs by how
stale they are, puts the count on the toolbar badge, and once a day asks if you
want to deal with a few of them. Every tab gets three options: keep, snooze, or
archive.

WHAT IT DOES

Review digest. Your open tabs, ranked by a staleness score. Idle days push a tab
up the list. Revisits, being pinned, and sitting in a tab group you have open
all push it back down. Pinned tabs basically never surface.

Daily prompt. Once a day, if anything is actually due, a notification asks
whether you want to review some tabs. It offers a batch of five rather than the
whole backlog. Showing the notification counts as asking, so ignoring it buys
the same day of quiet that dismissing it does. One toggle turns it off.

Toolbar badge. A count of the tabs currently worth reviewing, recomputed on
every tab change and every 30 minutes.

Snooze. Close a tab now and get it back later, either from the presets or by
typing a duration (30m, 2h, 3d, 1w). Snoozed tabs survive restarts, updates, and
crashes, and come back with their old idle clock rather than pretending to be
new.

Archive with full-text search. Archiving pulls the page's readable text, stores
it locally, and indexes it for fuzzy search across titles and body text with
highlighted snippets. Restoring a page does not delete the archived copy.

Tunable scoring. Every weight in the staleness formula is editable in Settings.
The defaults are guesses. How long a tab should sit before it is worth
surfacing depends entirely on how you work.

PRIVACY

No server, no analytics, no network requests. Everything stays in your browser
on your machine. Source is at https://github.com/zcao334/Tabbatical

## Single purpose statement

Tabbatical helps users review and clear stale browser tabs by scoring open tabs
on how long they have been idle and prompting a bounded review once a day.

## Permission justifications

tabs
  Tabbatical scores every open tab on how long it has been idle and shows the
  user a ranked list. It needs the tab's URL and title to identify the tab in
  that list and to restore it after a snooze. Tab data is stored locally in
  chrome.storage.local and is never transmitted.

tabGroups
  A tab sitting in a tab group the user currently has open is in active use, so
  the score pushes it down the list. Reading group state is the only way to
  detect that.

storage
  Stores tab activity, user settings, and snooze entries locally. The extension
  is event-driven and its service worker is unloaded when idle, so state that
  must survive between events cannot be kept in memory.

unlimitedStorage
  Archived pages include extracted page text, which grows past the default
  storage quota for a user who archives regularly. Without it, archiving fails
  once the quota is reached.

alarms
  Recomputes the review count every 30 minutes, because a tab becomes stale by
  sitting still, which fires no event of its own. Also wakes snoozed tabs at
  their scheduled time.

notifications
  Shows the once-daily review prompt. This is the extension's core proactive
  feature and the user can turn it off in Settings.

sidePanel
  The extension's entire interface (review digest, snoozed list, archive search,
  settings) is a side panel.

scripting
  Injects a content script into the page the user is archiving to extract its
  readable text with Mozilla's Readability. Injection happens only on the tab
  the user has chosen to archive, at the moment they click Archive.

Host permissions (http://*/* and https://*/*)
  Required to read the page text of a site being archived. These are declared as
  OPTIONAL host permissions, not granted at install. The extension requests
  access to a single site at the moment the user clicks Archive on a tab from
  that site, and a user who declines still gets the tab archived as title and
  URL only. No host permission is ever requested up front or for sites the user
  has not acted on.

## Data collection disclosures

Answer "no" to every category. Tabbatical does not collect or transmit any user
data. It contains no network code: no fetch, no XMLHttpRequest, no WebSocket, no
analytics SDK.

Privacy policy URL: https://github.com/zcao334/Tabbatical/blob/main/PRIVACY.md
