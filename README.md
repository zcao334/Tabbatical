# Tab Review

A Chrome extension that proactively reviews your open tabs and helps you decide what to keep, archive, or snooze — instead of letting clutter accumulate silently.

## Status: Week 1 — tracking layer + digest UI

- Background service worker tracks tab activity (last active time, revisit count, pin/group state).
- Side panel renders a digest of open tabs sorted by a staleness score (idle time weighted against revisits, pinning, and active grouping).
- "Keep" button acknowledges a tab and resets its idle clock.

Archive/search (Week 2–3) and snooze/settings (Week 4) are not implemented yet.

## Development

```bash
npm install
npm run dev     # watch build with HMR
npm run build   # production build to dist/
npm test        # vitest unit tests
```

The on-demand content extractor is bundled separately (see `buildExtractor` in
`vite.config.ts`) because it's injected at runtime rather than declared in the
manifest. Use `npm run build` when testing anything that archives a page.

## Loading the extension in Chrome

1. `npm run build`
2. Go to `chrome://extensions`, enable Developer mode.
3. Click "Load unpacked" and select the `dist/` directory.
4. Click the extension icon to open the side panel digest.
