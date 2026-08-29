# Tabbatical

A Chrome extension that asks you about your open tabs before you have eighty of them.

Tab clutter isn't a storage problem, it's an attention problem: nothing ever prompts you to
decide about a tab, so nothing ever gets closed. Tabbatical ranks your open tabs by how stale
they are, asks you about a handful of them once a day, and gives each one three answers —
**keep**, **snooze**, or **archive**.

## Why this exists

There is no shortage of tab extensions. They group tabs, suspend them to save memory, save
sessions, archive pages, or set a tab aside until later. Every individual mechanic here exists
somewhere else, and several are excellent at it.

What none of them do is **initiate**. They are all tools you have to remember to open, which
means they help exactly when you were already thinking about your tabs — the moment you least
need help. The pile grows during the weeks you aren't thinking about it.

Tabbatical is built around that gap. The scoring, the badge, the daily prompt and the recurring
recount all exist so the review starts without you asking for it, and so it arrives as a
specific, answerable question — *this tab, five days untouched, never revisited: keep it?* —
rather than a list of two hundred things.

The hard part isn't noticing stale tabs, it's earning the right to interrupt. A prompt that
arrives at the wrong moment, or twice, teaches you to dismiss it on sight, and a prompt you've
learned to dismiss is worse than none — so most of the rules in `shared/prompt.ts` are about
staying quiet.

## What it does

**Review digest.** Open tabs ranked by a staleness score: idle days count against a tab, while
revisits, being pinned, and sitting in a tab group you have open all count for it. Pinned tabs
are effectively exempt. Each row offers Keep, Snooze or Archive.

**A daily prompt.** Once a day, when tabs are actually due, a notification asks whether you want
to review a few of them. It names a batch — *review 5* — rather than a backlog, because a bounded
ask is one you can finish and a total is one you dismiss. Showing it counts as asking, so
ignoring it buys the same day of quiet that declining does; it can't turn into a thing that
reappears every half hour. It's off with one toggle, and it cannot fire on a fresh profile,
because there's nothing stale to prompt about yet.

**Toolbar badge.** A count of the tabs currently worth reviewing, recomputed on every change and
every half hour — because a tab goes stale by sitting still, which fires no event of its own. The
badge answers *how many*; the prompt asks *now?*. **Pin the extension** (see below) or the badge
is only visible in the puzzle menu.

**Snooze.** Close a tab now, get it back later — presets or a typed duration (`30m`, `2h`, `3d`,
`1w`). It survives everything an extension can be put through: the entry is stored and the alarm
is only a trigger, reconciled on every startup, so a browser restart, an extension update or a
crash doesn't lose a snoozed tab. A returning tab comes back with its idle clock intact rather
than pretending to be new. The Snoozed view lists what's pending and can wake or cancel early.

**Archive with full-text search.** Archiving captures the page's readable text with Mozilla's
Readability, stores it in IndexedDB, and indexes it for fuzzy search across titles and body text
with highlighted snippets. Pages that can't be read — a `chrome://` URL, a discarded tab, a site
without host permission — are archived as metadata and labelled `metadata only` rather than
failing silently. Host permission is requested per-origin, at the moment you click, and never up
front.

Restoring doesn't remove the entry: the capture may be the only surviving copy of a page that has
since changed or gone, so reopening one shouldn't quietly destroy it. Instead an entry whose page
is open right now is marked `open` and offers to switch to that tab rather than opening a second
copy of it.

**Two ways in.** The toolbar icon opens a dropdown; a button inside it docks the same views into
the side panel for a longer session, since a dropdown closes the moment you click a tab to look
at it. It's one document either way — it reads a marker off its own URL to know which surface it
is, and only the dropdown offers the button.

**Tunable scoring.** Every weight in the staleness formula is editable in Settings, next to the
prompt's own toggle and batch size, and a change re-ranks the digest immediately. The defaults
are a starting point, not an assertion — how long a tab should sit before it's worth surfacing
depends entirely on how you work.

## Install

```bash
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist/` directory.
3. **Pin the extension**: click the puzzle-piece icon in the toolbar, find Tabbatical, and click
   the pin. This matters more than it sounds — the badge is the whole proactive mechanism, and
   an unpinned extension hides it behind the puzzle menu, where you only see it if you were
   already going to look.
4. Click the icon for the dropdown, or **Dock to side** inside it for the side panel.

Tabs need a few days of real use before the digest has anything interesting to say, since
everything starts at zero idle days.

## Development

```bash
npm run dev     # watch build
npm run build   # typecheck + production build to dist/
npm test        # unit tests
```

Use `npm run build` rather than `dev` when testing anything that archives a page: the content
extractor is bundled separately (see `buildExtractor` in `vite.config.ts`) because it's injected
at runtime rather than declared in the manifest.

### Layout

| | |
|---|---|
| `src/background/` | Service worker and its logic: activity tracking, snooze, archive, badge, prompt |
| `src/shared/` | Everything both surfaces need — storage, scoring, search, types |
| `src/sidepanel/` | The four views and the row components they share, across all three surfaces |
| `src/content/` | The injected extractor |

Logic lives in `shared/` or in a named background module rather than in `service-worker.ts`,
which is kept to listener wiring. That file runs on import and can't be driven by a test, so
anything in it is untestable by construction — a revisit-counting bug survived three weeks there
before the logic was moved out to `background/activity.ts` and covered.

### Notes on the MV3 parts

The interesting constraints here come from Manifest V3, and three shaped most of the design:

**The service worker is unloaded after ~30 seconds idle.** Anything held in a module-scope
variable is gone by the next event, which is far more often than it sounds — thirty seconds is
ordinary time to spend reading one page. State that has to outlive an event goes in
`chrome.storage`, and memory is only ever a cache of it.

**Alarms are less durable than storage.** `chrome.alarms` doesn't survive every lifecycle event,
but `chrome.storage` does, so a snooze is a stored entry that an alarm merely triggers. Startup
reconciles the two: anything overdue wakes, anything pending gets its alarm re-armed.

**`chrome.sidePanel.open()` requires a user gesture**, so no alarm can open the panel — and a
notification click doesn't count as one either, which the docs don't say and only testing
settles. The daily prompt is therefore a notification that opens the review in a tab, focusing
the window on the way, since a click that arrives from another application would otherwise open
something invisible behind an unfocused browser. A panel-shaped popup window was tried instead
and reverted: on macOS, opening a window pulls the user to a different Space, which is a worse
interruption than an extra tab. The prompt also rides the existing half-hourly
alarm rather than owning a daily one, since a daily alarm can't fire while Chrome is closed and
would drift by however long the browser was shut.

## Status

Feature-complete for the planned scope. Review digest, snooze, archive, search, settings, the
badge and the daily prompt are all implemented and tested; a demo GIF ([#20](https://github.com/zcao334/Tabbatical/issues/20))
and an Edge compatibility pass ([#13](https://github.com/zcao334/Tabbatical/issues/13)) are open.
