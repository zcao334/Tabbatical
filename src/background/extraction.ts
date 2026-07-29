import { isExtractionResultMessage, type ExtractedContent } from '../shared/messages';
import { hasHostPermission, isInjectableUrl } from '../shared/permissions';

/**
 * Long enough that a slow machine or a heavy page doesn't fail spuriously,
 * short enough that a hung page doesn't leave the archive action spinning.
 * Real extraction finishes well under a second.
 */
const EXTRACTION_TIMEOUT_MS = 5_000;

export type ExtractionOutcome =
  /** Readability found an article. */
  | { status: 'extracted'; content: ExtractedContent }
  /** Ran fine, but the page has no article body (dashboard, search results). */
  | { status: 'empty' }
  /** Chrome already unloaded the tab; we won't reload it just to read it. */
  | { status: 'discarded' }
  /** User hasn't granted host access for this origin yet. */
  | { status: 'no-permission' }
  /** chrome://, the Web Store, PDFs — pages extensions may not script. */
  | { status: 'unsupported' }
  /** Injection error or timeout. */
  | { status: 'failed' };

/**
 * Emitted by the buildExtractor plugin in vite.config.ts at a fixed,
 * unhashed path — injected scripts aren't referenced by the manifest, so
 * there's nothing to resolve the name from at runtime.
 */
const EXTRACTOR_PATH = 'content/extract.js';

/** Listens for this tab's extraction reply, resolving `undefined` on timeout. */
function awaitExtractionResult(tabId: number) {
  let settle!: (value: ExtractedContent | null | undefined) => void;
  const promise = new Promise<ExtractedContent | null | undefined>((resolve) => {
    settle = resolve;
  });

  const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
    // One extraction runs per tab at a time, so the sender tab is enough to
    // correlate the reply without threading a request id into the injection.
    if (sender.tab?.id !== tabId) return;
    if (!isExtractionResultMessage(message)) return;
    cleanup();
    settle(message.content);
  };

  const timer = setTimeout(() => {
    cleanup();
    settle(undefined);
  }, EXTRACTION_TIMEOUT_MS);

  function cleanup() {
    clearTimeout(timer);
    chrome.runtime.onMessage.removeListener(listener);
  }

  chrome.runtime.onMessage.addListener(listener);
  return { promise, cancel: cleanup };
}

/**
 * Pull readable content out of a tab. Never throws — every failure mode maps
 * to an outcome so the archive flow can fall back to metadata-only rather
 * than losing the capture.
 */
export async function extractTabContent(tabId: number): Promise<ExtractionOutcome> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { status: 'failed' };
  }

  const url = tab.url ?? '';
  if (!isInjectableUrl(url)) return { status: 'unsupported' };

  // Chrome discards precisely the idle tabs this extension targets, so this
  // is a common path, not an edge case. Reloading to read one would be slow,
  // network-dependent, and would re-run page scripts for content the user is
  // already discarding.
  if (tab.discarded) return { status: 'discarded' };

  if (!(await hasHostPermission(url))) return { status: 'no-permission' };

  const pending = awaitExtractionResult(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [EXTRACTOR_PATH] });
  } catch (error) {
    pending.cancel();
    console.error('[Tab Review] Failed to inject the extractor', error);
    return { status: 'failed' };
  }

  const content = await pending.promise;
  if (content === undefined) return { status: 'failed' };
  if (content === null) return { status: 'empty' };
  return { status: 'extracted', content };
}
