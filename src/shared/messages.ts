/**
 * Content the extractor pulled off a page, before it becomes an ArchiveEntry.
 *
 * `textContent` is absent whenever the page isn't an article — the other
 * fields are still worth keeping, so a non-article page yields a populated
 * object rather than nothing at all.
 */
export interface ExtractedContent {
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  textContent?: string;
  faviconUrl?: string;
}

export const EXTRACTION_RESULT = 'tab-review:extraction-result';

/**
 * Sent by the injected extractor once per injection. `content` is null when
 * Readability ran but found no article body (a dashboard, a search results
 * page), which is distinct from extraction failing outright.
 */
export interface ExtractionResultMessage {
  type: typeof EXTRACTION_RESULT;
  content: ExtractedContent | null;
}

export function isExtractionResultMessage(value: unknown): value is ExtractionResultMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === EXTRACTION_RESULT
  );
}

export const EXTRACT_TAB_REQUEST = 'tab-review:extract-tab';

/**
 * Asks the background to extract a tab's content. Extraction is orchestrated
 * there rather than in the side panel so closing the panel mid-archive can't
 * tear down an in-flight capture.
 */
export interface ExtractTabRequest {
  type: typeof EXTRACT_TAB_REQUEST;
  tabId: number;
}

export function isExtractTabRequest(value: unknown): value is ExtractTabRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === EXTRACT_TAB_REQUEST &&
    typeof (value as { tabId?: unknown }).tabId === 'number'
  );
}

export const ARCHIVE_TAB_REQUEST = 'tab-review:archive-tab';

/** Asks the background to capture a tab into the archive and close it. */
export interface ArchiveTabRequest {
  type: typeof ARCHIVE_TAB_REQUEST;
  tabId: number;
}

export type ArchiveTabResponse =
  /** Stored and closed. `hasFullText` is false for metadata-only captures. */
  | { status: 'archived'; hasFullText: boolean }
  /** User declined host access; nothing was stored and the tab is untouched. */
  | { status: 'cancelled' }
  | { status: 'failed' };

export function isArchiveTabRequest(value: unknown): value is ArchiveTabRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === ARCHIVE_TAB_REQUEST &&
    typeof (value as { tabId?: unknown }).tabId === 'number'
  );
}

export const SNOOZE_TAB_REQUEST = 'tab-review:snooze-tab';

/**
 * Asks the background to close a tab and schedule its return.
 *
 * Handled in the service worker rather than the side panel because the alarm
 * and the stored record have to be written even if the panel closes the
 * instant the button is clicked — and because the panel has no way to be
 * running when the alarm eventually fires.
 */
export interface SnoozeTabRequest {
  type: typeof SNOOZE_TAB_REQUEST;
  tabId: number;
  durationMs: number;
}

export type SnoozeTabResponse =
  /** Recorded, scheduled and closed. `wakeAt` is the absolute return time. */
  | { status: 'snoozed'; wakeAt: number }
  | { status: 'failed' };

export function isSnoozeTabRequest(value: unknown): value is SnoozeTabRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === SNOOZE_TAB_REQUEST &&
    typeof (value as { tabId?: unknown }).tabId === 'number' &&
    typeof (value as { durationMs?: unknown }).durationMs === 'number'
  );
}
