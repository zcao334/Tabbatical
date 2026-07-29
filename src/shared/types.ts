export interface TabActivity {
  tabId: number;
  url: string;
  title: string;
  lastActiveAt: number;
  revisitCount: number;
  groupId: number | null;
  pinned: boolean;
}

export interface StalenessConfig {
  idleDayWeight: number;
  revisitWeight: number;
  activeGroupPenalty: number;
  pinnedPenalty: number;
}

export const DEFAULT_STALENESS_CONFIG: StalenessConfig = {
  idleDayWeight: 10,
  revisitWeight: 5,
  activeGroupPenalty: 15,
  pinnedPenalty: 1000,
};

/**
 * A tab captured into the archive. Written by the archive flow, read by the
 * archive view and (later) the search index.
 *
 * The optional content fields are absent whenever full-text extraction
 * couldn't run — a discarded tab, a page we lack host permission for, a
 * chrome:// URL, or an extraction timeout. `hasFullText` states that
 * explicitly rather than leaving callers to infer it from an empty string,
 * which would conflate "never attempted" with "attempted and found nothing".
 */
export interface ArchiveEntry {
  id: string;
  url: string;
  title: string;
  archivedAt: number;
  hasFullText: boolean;
  faviconUrl?: string;
  extractedText?: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
}

/**
 * Upper bound on stored article text. A long article runs 10-20KB, so this
 * keeps essentially all real content while bounding pathological pages
 * (huge API references, 400-comment threads, infinite-scroll feeds).
 *
 * This also caps what the search index has to hold in memory later, so it's
 * cheaper to enforce at capture time than to retrofit onto stored entries.
 */
export const MAX_EXTRACTED_TEXT_LENGTH = 50_000;
