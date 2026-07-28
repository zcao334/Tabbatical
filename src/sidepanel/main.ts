import { renderDigest } from './digest';

const container = document.getElementById('digest-list');
if (container) {
  void renderDigest(container);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tabActivityMap) {
      void renderDigest(container);
    }
  });
}
