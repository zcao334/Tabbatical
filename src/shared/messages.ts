/** Content the extractor pulled off a page, before it becomes an ArchiveEntry. */
export interface ExtractedContent {
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  textContent?: string;
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
