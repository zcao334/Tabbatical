import { renderDigest } from './digest';
import { initArchiveSearch, renderArchive } from './archive';

const digestList = document.getElementById('digest-list');
const archiveList = document.getElementById('archive-list');
const archiveSearch = document.getElementById('archive-search');
const digestTab = document.getElementById('tab-digest');
const archiveTab = document.getElementById('tab-archive');
const digestView = document.getElementById('view-digest');
const archiveView = document.getElementById('view-archive');

type ViewName = 'digest' | 'archive';
let activeView: ViewName = 'digest';

function showView(view: ViewName): void {
  activeView = view;
  const showingDigest = view === 'digest';

  digestView?.toggleAttribute('hidden', !showingDigest);
  archiveView?.toggleAttribute('hidden', showingDigest);
  digestTab?.setAttribute('aria-selected', String(showingDigest));
  archiveTab?.setAttribute('aria-selected', String(!showingDigest));
  digestTab?.classList.toggle('is-active', showingDigest);
  archiveTab?.classList.toggle('is-active', !showingDigest);

  // The archive has no change notifications of its own — IndexedDB writes
  // happen in the service worker and don't broadcast — so it's refreshed on
  // entry rather than kept live. Anything archived while the digest was
  // showing appears as soon as the user switches over.
  if (!showingDigest && archiveList) void renderArchive(archiveList);
}

digestTab?.addEventListener('click', () => showView('digest'));
archiveTab?.addEventListener('click', () => showView('archive'));

if (archiveList && archiveSearch instanceof HTMLInputElement) {
  initArchiveSearch(archiveSearch, archiveList);
}

if (digestList) {
  void renderDigest(digestList);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.tabActivityMap) return;
    void renderDigest(digestList);

    // An archive both writes an entry and closes the tab, so a tab-map change
    // is the one signal the side panel gets that the archive may have grown.
    if (activeView === 'archive' && archiveList) void renderArchive(archiveList);
  });
}
