import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { isArticleLike, normalizeWhitespace } from '../shared/article-quality';
import { MAX_EXTRACTED_TEXT_LENGTH } from '../shared/types';
import {
  EXTRACTION_RESULT,
  type ExtractedContent,
  type ExtractionResultMessage,
} from '../shared/messages';

/**
 * Injected on demand by the archive flow — never registered as a declarative
 * content script, so it costs nothing on pages the user never archives.
 *
 * Runs top-to-bottom on injection and reports its result back over
 * chrome.runtime.sendMessage; the background correlates the reply by sender
 * tab id.
 */

/** Readability yields '' for absent fields; store nothing rather than empty strings. */
function orUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The page's own favicon, as an absolute URL.
 *
 * A fallback for chrome.tabs.Tab.favIconUrl, which Chrome leaves undefined
 * often enough that the archive would otherwise have no icon to show. Falls
 * back to /favicon.ico, the location browsers probe when a page declares no
 * icon at all.
 */
function findFaviconUrl(): string | undefined {
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]',
  );
  const href = link?.getAttribute('href');

  try {
    return href
      ? new URL(href, document.baseURI).href
      : new URL('/favicon.ico', location.origin).href;
  } catch {
    return undefined;
  }
}

function extract(): ExtractedContent | null {
  const faviconUrl = findFaviconUrl();

  // Cheap structural pre-filter. Catches the clear non-articles without
  // paying for a full parse; the quality gate below catches what it misses.
  if (!isProbablyReaderable(document)) {
    return { title: orUndefined(document.title), faviconUrl };
  }

  // Readability strips and rewrites the document it parses, so hand it a
  // detached clone. Parsing the live document would visibly gut the page
  // in front of the user before the tab is archived.
  const clone = document.cloneNode(true) as Document;
  const article = new Readability(clone).parse();

  // Metadata is worth keeping even when there's no article, so every
  // rejection below still returns a populated object.
  const metadataOnly: ExtractedContent = {
    title: orUndefined(article?.title) ?? orUndefined(document.title),
    siteName: orUndefined(article?.siteName),
    excerpt: orUndefined(article?.excerpt),
    faviconUrl,
  };
  if (!article) return metadataOnly;

  const text = normalizeWhitespace(article.textContent ?? '');

  // Parsed inert via DOMParser rather than by assigning innerHTML to a
  // detached element — an inert document never fetches the images and other
  // subresources the markup references.
  const parsed = new DOMParser().parseFromString(article.content ?? '', 'text/html');
  if (!isArticleLike(parsed.body, text)) return metadataOnly;

  return {
    title: orUndefined(article.title),
    byline: orUndefined(article.byline),
    siteName: orUndefined(article.siteName),
    excerpt: orUndefined(article.excerpt),
    textContent: orUndefined(text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)),
    faviconUrl,
  };
}

let content: ExtractedContent | null = null;
try {
  content = extract();
} catch (error) {
  // A parse failure is reported the same as "no article found" — the archive
  // flow falls back to metadata-only either way.
  console.error('[Tabbatical] Content extraction failed', error);
}

const message: ExtractionResultMessage = { type: EXTRACTION_RESULT, content };
void chrome.runtime.sendMessage(message);
