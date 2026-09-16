/**
 * Fill the digest with demo data for screenshots.
 *
 * Paste into the service worker console: chrome://extensions, Tabbatical,
 * "service worker". The side panel re-renders on its own.
 *
 * Screenshots of a real profile publish real browsing history, since the
 * digest renders the url and title stored for every tracked tab. This replaces
 * that with invented tabs so a screenshot can go in a public README.
 *
 * Your real tracking data is copied to tabActivityMapBackup first. Run
 * restoreTabs() at the bottom to put it back.
 */

const DEMO_TABS = [
  ['The Rust Programming Language: Ownership', 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html', 11.2, 0],
  ['Designing Data-Intensive Applications', 'https://dataintensive.net/', 8.5, 1],
  ['chrome.alarms | Chrome Extensions', 'https://developer.chrome.com/docs/extensions/reference/api/alarms', 6.4, 0],
  ['Using IndexedDB - Web APIs | MDN', 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB', 5.1, 2],
  ['Service worker terminated before activation - Stack Overflow', 'https://stackoverflow.com/questions/60469617', 4.3, 0],
  ['GitHub - vitejs/vite', 'https://github.com/vitejs/vite', 3.6, 1],
  ['TypeScript Handbook: Generics', 'https://www.typescriptlang.org/docs/handbook/2/generics.html', 2.4, 1],
  ['Hacker News', 'https://news.ycombinator.com/', 1.8, 4],
];

async function seedTabs() {
  const existing = (await chrome.storage.local.get('tabActivityMap')).tabActivityMap ?? {};
  await chrome.storage.local.set({ tabActivityMapBackup: existing });

  const now = Date.now();
  const map = {};
  DEMO_TABS.forEach(([title, url, daysIdle, revisitCount], i) => {
    const tabId = 90001 + i;
    map[tabId] = {
      tabId,
      url,
      title,
      lastActiveAt: now - daysIdle * 86400000,
      revisitCount,
      groupId: null,
      pinned: false,
    };
  });

  await chrome.storage.local.set({ tabActivityMap: map });
  console.log(`seeded ${DEMO_TABS.length} demo tabs; real data saved to tabActivityMapBackup`);
}

async function restoreTabs() {
  const { tabActivityMapBackup } = await chrome.storage.local.get('tabActivityMapBackup');
  if (!tabActivityMapBackup) {
    console.warn('no backup found; nothing restored');
    return;
  }
  await chrome.storage.local.set({ tabActivityMap: tabActivityMapBackup });
  await chrome.storage.local.remove('tabActivityMapBackup');
  console.log('real tab data restored');
}

await seedTabs();
// Run restoreTabs() when you are done taking screenshots.
