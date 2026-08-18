/** Shared by staleness scoring and both views' relative-time labels. */
export const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
 * A run of text with one span called out inside it — a search snippet and the
 * offsets of the term that matched.
 *
 * Offsets rather than pre-built markup so the renderer can highlight using text
 * nodes; the side panel never assigns innerHTML from stored page content.
 */
export interface Snippet {
  text: string;
  matchStart: number;
  matchLength: number;
}

/**
 * A tab closed on purpose with a scheduled return.
 *
 * Unlike an archive entry this holds no page content — a snoozed tab is coming
 * back as a live page, so there's nothing to capture. It does keep enough to
 * reopen and to describe the tab, since the tab itself is gone the moment the
 * snooze starts and this record is the only thing left of it.
 *
 * `id` is generated rather than reusing the tab id: tab ids are recycled by
 * Chrome, and this record has to outlive the tab, the window, and often the
 * browser session.
 */
export interface SnoozedTab {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  snoozedAt: number;
  wakeAt: number;
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
