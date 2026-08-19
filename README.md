# Tabbatical

A Chrome extension that asks you about your open tabs before you have eighty of them.

Tab clutter isn't a storage problem, it's an attention problem: nothing ever prompts you to
decide about a tab, so nothing ever gets closed. Tabbatical ranks your open tabs by how stale
they are, puts a count on the toolbar when some are worth reviewing, and gives each one three
answers — **keep**, **snooze**, or **archive**.

## Why this exists

There is no shortage of tab extensions. They group tabs, suspend them to save memory, save
sessions, archive pages, or set a tab aside until later. Every individual mechanic here exists
somewhere else, and several are excellent at it.

What none of them do is **initiate**. They are all tools you have to remember to open, which
means they help exactly when you were already thinking about your tabs — the moment you least
need help. The pile grows during the weeks you aren't thinking about it.

Tabbatical is built around that gap. The scoring, the badge and the recurring recount all exist
so that the review starts without you asking for it, and so the prompt arrives with a specific,
answerable question — *this tab, five days untouched, never revisited: keep it?* — rather than a
list of two hundred things.

## What it does

**Review digest.** Open tabs ranked by a staleness score: idle days count against a tab, while
revisits, being pinned, and sitting in a tab group you have open all count for it. Pinned tabs
are effectively exempt. Each row offers Keep, Snooze or Archive.

**Toolbar badge.** A count of the tabs currently worth reviewing, recomputed on every change and
every half hour — because a tab goes stale by sitting still, which fires no event of its own.
This is the part that makes the extension proactive, so **pin the extension** (see below).

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

**Tunable scoring.** Every weight in the staleness formula is editable in Settings, and changes
re-rank the digest immediately. The defaults are a starting point, not an assertion — how long a
tab should sit before it's worth surfacing depends entirely on how you work.

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
4. Click the icon to open the side panel.

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
| `src/background/` | Service worker and its logic: activity tracking, snooze, archive, badge |
| `src/shared/` | Everything both surfaces need — storage, scoring, search, types |
| `src/sidepanel/` | The four views and the row components they share |
| `src/content/` | The injected extractor |

Logic lives in `shared/` or in a named background module rather than in `service-worker.ts`,
which is kept to listener wiring. That file runs on import and can't be driven by a test, so
anything in it is untestable by construction — a revisit-counting bug survived three weeks there
before the logic was moved out to `background/activity.ts` and covered.

### Notes on the MV3 parts

The interesting constraints here come from Manifest V3, and two shaped most of the design:

**The service worker is unloaded after ~30 seconds idle.** Anything held in a module-scope
variable is gone by the next event, which is far more often than it sounds — thirty seconds is
ordinary time to spend reading one page. State that has to outlive an event goes in
`chrome.storage`, and memory is only ever a cache of it.

**Alarms are less durable than storage.** `chrome.alarms` doesn't survive every lifecycle event,
but `chrome.storage` does, so a snooze is a stored entry that an alarm merely triggers. Startup
reconciles the two: anything overdue wakes, anything pending gets its alarm re-armed.

## Status

Feature-complete for the planned scope. Review digest, snooze, archive, search, settings and the
badge are all implemented and tested; a demo GIF ([#20](https://github.com/zcao334/Tabbatical/issues/20))
and an Edge compatibility pass ([#13](https://github.com/zcao334/Tabbatical/issues/13)) are open.
