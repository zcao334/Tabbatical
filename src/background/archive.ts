import { addArchiveEntry, type NewArchiveEntry } from '../shared/archive-db';
import type { ArchiveTabResponse } from '../shared/messages';
import { extractTabContent, type ExtractionOutcome } from './extraction';

/** The parts of a tab an archive entry is built from. */
type ArchivableTab = Pick<chrome.tabs.Tab, 'url' | 'title' | 'favIconUrl'>;

/**
 * Map an extraction outcome onto a storable entry.
 *
 * Every outcome except a declined permission still produces an entry — a
 * chrome:// page, a PDF, a discarded tab and an injection failure all archive
 * as metadata-only rather than failing the action. `hasFullText` keys off the
 * text actually present, so an extraction that "succeeded" but yielded nothing
 * is honestly recorded as metadata-only.
 *
 * Returns null when the tab has no URL, which is the one case with nothing
 * worth storing — and which would also collide on the unique by-url index.
 */
export function buildArchiveEntry(
  tab: ArchivableTab,
  outcome: ExtractionOutcome,
): NewArchiveEntry | null {
  const url = tab.url?.trim();
  if (!url) return null;

  const content = outcome.status === 'extracted' ? outcome.content : undefined;

  return {
    url,
    title: content?.title || tab.title?.trim() || url,
    hasFullText: Boolean(content?.textContent),
    faviconUrl: tab.favIconUrl,
    extractedText: content?.textContent,
    excerpt: content?.excerpt,
    byline: content?.byline,
    siteName: content?.siteName,
  };
}

/**
 * Capture a tab into the archive and close it.
 *
 * Runs in the service worker so closing the side panel mid-flight can't abort
 * a capture partway through.
 */
export async function archiveTab(tabId: number): Promise<ArchiveTabResponse> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { status: 'failed' };
  }

  const outcome = await extractTabContent(tabId);

  // Declining the prompt reads as "don't do this", not "do a worse version",
  // so a missing permission cancels rather than downgrading to metadata-only.
  if (outcome.status === 'no-permission') return { status: 'cancelled' };

  const entry = buildArchiveEntry(tab, outcome);
  if (!entry) return { status: 'failed' };

  // Store before closing, never concurrently: a tab closed against a failed
  // write is the one unrecoverable failure in this flow.
  try {
    await addArchiveEntry(entry);
  } catch (error) {
    console.error('[Tab Review] Failed to write archive entry', error);
    return { status: 'failed' };
  }

  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // The capture is already safe; a tab that closed itself first is fine.
    console.warn('[Tab Review] Archived, but could not close the tab', error);
  }

  // Closing the tab fires onRemoved, which prunes the tracking map and in turn
  // triggers the side panel's storage listener — so no explicit cleanup here.
  return { status: 'archived', hasFullText: entry.hasFullText };
}
