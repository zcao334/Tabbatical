import { Readability } from '@mozilla/readability';
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

/** Collapse Readability's generous whitespace so stored text stays compact. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Readability yields '' for absent fields; store nothing rather than empty strings. */
function orUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function extract(): ExtractedContent | null {
  // Readability strips and rewrites the document it parses, so hand it a
  // detached clone. Parsing the live document would visibly gut the page
  // in front of the user before the tab is archived.
  const clone = document.cloneNode(true) as Document;
  const article = new Readability(clone).parse();
  if (!article) return null;

  const text = normalizeWhitespace(article.textContent ?? '');

  return {
    title: orUndefined(article.title),
    byline: orUndefined(article.byline),
    siteName: orUndefined(article.siteName),
    excerpt: orUndefined(article.excerpt),
    textContent: orUndefined(text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)),
  };
}

let content: ExtractedContent | null = null;
try {
  content = extract();
} catch (error) {
  // A parse failure is reported the same as "no article found" — the archive
  // flow falls back to metadata-only either way.
  console.error('[Tab Review] Content extraction failed', error);
}

const message: ExtractionResultMessage = { type: EXTRACTION_RESULT, content };
void chrome.runtime.sendMessage(message);
