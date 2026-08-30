import { renderDigest } from './digest';
import { initArchiveSearch, renderArchive } from './archive';
import { renderSnoozed } from './snoozed';
import { renderSettings } from './settings';

type ViewName = 'digest' | 'snoozed' | 'archive' | 'settings';

interface View {
  tab: HTMLElement | null;
  section: HTMLElement | null;
  list: HTMLElement | null;
  render: (container: HTMLElement) => void | Promise<void>;
}

const views: Record<ViewName, View> = {
  digest: {
    tab: document.getElementById('tab-digest'),
    section: document.getElementById('view-digest'),
    list: document.getElementById('digest-list'),
    render: renderDigest,
  },
  snoozed: {
    tab: document.getElementById('tab-snoozed'),
    section: document.getElementById('view-snoozed'),
    list: document.getElementById('snoozed-list'),
    render: renderSnoozed,
  },
  archive: {
    tab: document.getElementById('tab-archive'),
    section: document.getElementById('view-archive'),
    list: document.getElementById('archive-list'),
    render: renderArchive,
  },
  settings: {
    tab: document.getElementById('tab-settings'),
    section: document.getElementById('view-settings'),
    list: document.getElementById('settings-form'),
    render: renderSettings,
  },
};

const VIEW_NAMES = Object.keys(views) as ViewName[];

let activeView: ViewName = 'digest';

function refresh(name: ViewName): void {
  const { list, render } = views[name];
  if (list) void render(list);
}

function showView(name: ViewName): void {
  activeView = name;

  for (const candidate of VIEW_NAMES) {
    const view = views[candidate];
    const selected = candidate === name;
    view.section?.toggleAttribute('hidden', !selected);
    view.tab?.setAttribute('aria-selected', String(selected));
    view.tab?.classList.toggle('is-active', selected);
  }

  // Neither the archive nor the snoozed list is kept live off its own store —
  // the archive's writes happen in IndexedDB and broadcast nothing, and a
  // snooze that woke on its own only shows up on a re-read. Both refresh on
  // entry, so anything that changed while another view was showing appears as
  // soon as the user switches over.
  if (name !== 'digest') refresh(name);
}

for (const name of VIEW_NAMES) {
  views[name].tab?.addEventListener('click', () => showView(name));
}

const archiveSearch = document.getElementById('archive-search');
if (views.archive.list && archiveSearch instanceof HTMLInputElement) {
  initArchiveSearch(archiveSearch, views.archive.list);
}

if (views.digest.list) {
  refresh('digest');

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.tabActivityMap) {
      refresh('digest');

      // An archive both writes an entry and closes the tab, so a tab-map
      // change is the one signal the panel gets that the archive may have
      // grown.
      if (activeView === 'archive') refresh('archive');
    }

    // Covers a tab waking on its own with the list open, which is otherwise
    // the one change this view would show stale.
    if (changes.snoozedTabs && activeView === 'snoozed') refresh('snoozed');

    // Re-rank on a weight change, so switching back from Settings shows the
    // new order rather than the order the panel was opened with. Deliberately
    // one-way: the settings form is never rebuilt from its own write, which
    // would pull the caret out of the field being edited.
    if (changes.stalenessConfig) refresh('digest');
  });

  // The archive marks entries whose page is open right now, and the tab map
  // is not a usable signal for that: a newly created tab isn't tracked until
  // it has been dwelt on for several seconds, so restoring a page would leave
  // its own row claiming the page was closed. These fire immediately.
  const refreshArchiveIfShowing = () => {
    if (activeView === 'archive') refresh('archive');
  };

  chrome.tabs.onCreated.addListener(refreshArchiveIfShowing);
  chrome.tabs.onRemoved.addListener(refreshArchiveIfShowing);
  // A tab navigating away from an archived URL stops matching it, and one
  // navigating to it starts.
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) refreshArchiveIfShowing();
  });
}
