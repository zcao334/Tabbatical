# Tabbatical

A Chrome extension that nags you about stale tabs so you actually close some.

Most tab extensions wait for you to open them. That's the problem. You only open a tab manager
when you're already thinking about your tabs, which is the one moment you don't need help. The
rest of the time the pile just grows.

Tabbatical starts the conversation instead. It scores your open tabs by how stale they are, puts
the count on the toolbar badge, and once a day asks if you want to deal with a few of them. Every
tab gets three options: keep, snooze, or archive.

## Why bother

There are plenty of extensions that group tabs, suspend them to save memory, save sessions, or set
a tab aside for later. Some are very good. They're all passive.

The hard part here turned out to be the interrupting, not the scoring. A notification that shows
up at a bad time, or shows up twice, teaches you to swat it without reading. After that it's
worthless. Most of the rules in `shared/prompt.ts` are about keeping it quiet.

## What it does

### Review digest

Your open tabs, ranked by a staleness score. Idle days push a tab up the list. Revisits, being
pinned, and sitting in a tab group you have open all push it back down. Pinned tabs basically
never surface. Each row has Keep, Snooze and Archive on it.

### Daily prompt

Once a day, if anything is actually due, a notification asks whether you want to review some tabs.
It offers a batch ("Review 5") rather than the whole backlog, on the theory that you can finish 5
and you'll ignore 200.

Showing the notification counts as asking, so ignoring it buys the same day of quiet that clicking
"Not today" does. It can't degrade into something that reappears every half hour. One toggle turns
it off. It won't fire on a fresh profile because nothing is stale yet.

### Toolbar badge

A count of the tabs currently worth reviewing, recomputed on every tab change and every 30 minutes.
The recount matters because a tab goes stale by sitting still, which fires no event of its own.

Pin the extension or you won't see it. See step 3 below.

### Snooze

Close a tab now, get it back later, either from the presets or by typing a duration (`30m`, `2h`,
`3d`, `1w`).

The entry lives in storage and the alarm only triggers it, so restarting Chrome, updating the
extension or crashing won't lose a snoozed tab. Startup reconciles the two: anything overdue wakes
up, anything still pending gets its alarm re-armed. A tab that comes back keeps its old idle clock
instead of pretending to be new. The Snoozed view lists what's pending and can wake or cancel
early.

### Archive with full-text search

Archiving pulls the page's readable text with Mozilla's Readability, stores it in IndexedDB, and
indexes it for fuzzy search across titles and body text with highlighted snippets.

Some pages can't be read: `chrome://` URLs, discarded tabs, sites you haven't granted permission
for. Those get archived as metadata and tagged `metadata only`, so at least you know what you got.
Host permission is requested per site, at the moment you click, never up front.

Restoring doesn't delete the entry. The capture might be the only surviving copy of a page that has
since changed or disappeared, so reopening one shouldn't quietly destroy it. If the page is already
open you get an `open` tag and a button to switch to that tab instead of opening a second copy.

### Tunable scoring

Every weight in the staleness formula is editable in Settings, next to the prompt's toggle and
batch size. Changing one re-ranks the digest immediately. The defaults are guesses. How long a tab
should sit before it's worth surfacing depends entirely on how you work.

## Install

Not on the Chrome Web Store, so you build it and load it unpacked.

```bash
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `dist/` directory.
3. **Pin it.** Click the puzzle-piece icon in the toolbar, find Tabbatical, click the pin. Don't
   skip this one. The badge is the entire proactive mechanism, and unpinned it sits in the puzzle
   menu where you'll only see it if you were already going to look.
4. Click the icon to open the side panel.

Don't expect much for the first few days. Everything starts at zero idle days.

## Development

```bash
npm run dev     # watch build
npm run build   # typecheck + production build to dist/
npm test        # unit tests, 401 across 21 files
```

The scoring, prompt timing, storage and search logic are covered; the parts that
only call chrome APIs are not. `chrome` is stubbed in tests, so the suite runs
without a browser.

Use `npm run build` rather than `dev` when testing anything that archives a page. The content
extractor is bundled separately (see `buildExtractor` in `vite.config.ts`) because it's injected at
runtime rather than declared in the manifest.

The icons are generated from `src/icons/icon.svg` by `tools/render-icons.sh`. That script is macOS
only, since it shells out to `qlmanage`, so it's kept out of `npm run build`.

### Layout

| Directory | Contents |
|---|---|
| `src/background/` | Service worker and its logic: activity tracking, snooze, archive, badge, prompt |
| `src/shared/` | Everything both surfaces need: storage, scoring, search, types |
| `src/sidepanel/` | The four views and the row components they share |
| `src/content/` | The injected extractor |

`service-worker.ts` is listener wiring and nothing else. Logic belongs in `shared/` or in a named
module under `background/`. The file runs on import, so no test can drive it, which makes anything
living there untestable by construction. A revisit-counting bug sat in it for three weeks before
the logic moved out to `background/activity.ts` and got covered.

### MV3 gotchas

Three Manifest V3 constraints shaped most of the design.

**The service worker is killed after about 30 seconds idle.** Anything in a module-scope variable
is gone by the next event, and 30 seconds is not long. It's an ordinary amount of time to spend
reading one page. State that has to survive goes in `chrome.storage`, and memory is only ever a
cache of it.

**Alarms are less durable than storage.** `chrome.alarms` doesn't survive every lifecycle event but
`chrome.storage` does, which is why a snooze is a stored entry that an alarm merely triggers.

**`chrome.sidePanel.open()` needs a user gesture.** No alarm can open the panel, and a notification
click doesn't count as a gesture either, which the docs don't mention anywhere. So the daily prompt
opens the review in a tab and focuses the window on the way, otherwise a click arriving from
another application opens something invisible behind an unfocused browser.

A panel-shaped popup window got tried instead and then reverted: on macOS, opening a window drags
you to a different Space, which is a worse interruption than an extra tab.

The prompt also rides the existing half-hourly alarm rather than owning a daily one. A daily alarm
can't fire while Chrome is closed, so it would drift by however long the browser was shut.

## Status

Everything in the planned scope is built and tested: digest, snooze, archive, search, settings,
badge, daily prompt. Still open are a demo GIF
([#20](https://github.com/zcao334/Tabbatical/issues/20)) and an Edge compatibility pass
([#13](https://github.com/zcao334/Tabbatical/issues/13)).

## License

MIT. See [LICENSE](LICENSE).
