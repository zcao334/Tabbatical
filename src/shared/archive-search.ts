/**
 * Client-side search over archived pages. No network calls — everything runs
 * against entries already in memory.
 *
 * Metadata and body text are searched by different means, which a benchmark
 * against realistic corpora settled rather than taste:
 *
 * - Fuse matches metadata (title, site, byline, excerpt, URL). These fields are
 *   short, so fuzzy matching is cheap, and it's where typos actually happen —
 *   "wikipeda" finds "Wikipedia", "gardne" finds "garden".
 * - Body text is matched by substring. Fuse's defaults only look near the start
 *   of a field (`distance: 100`), so a keyword deep in a 50KB article is missed
 *   outright — 1 of 5 planted needles found. `ignoreLocation: true` fixes that
 *   but costs ~360ms per keystroke over 500 entries, and fuzzy matching across
 *   that much prose finds a near-match for almost anything: at the default
 *   threshold "inflation" matched a baking article and a gardening article.
 *   Substring is exact, ~0.2ms over the same corpus, and gives us the match
 *   offset needed for a snippet.
 */

import Fuse from 'fuse.js';
import type { ArchiveEntry, Snippet } from './types';

/**
 * Title is weighted highest because it's what the user is most likely to
 * half-remember; the URL is searchable but shouldn't outrank real text.
 */
const METADATA_KEYS = [
  { name: 'title', weight: 4 },
  { name: 'excerpt', weight: 2 },
  { name: 'siteName', weight: 1 },
  { name: 'byline', weight: 1 },
  { name: 'url', weight: 1 },
];

/**
 * Fuzziness is budgeted in typos, not as a fixed rate.
 *
 * Fuse's `threshold` is a normalized error *rate*, so one setting can't serve
 * queries of different lengths: at the 0.3 needed to recover "wikipeda", a
 * four-letter "fate" also matched "Fox News - Breaking News Updates", because
 * 0.3 of four characters is more than an edit's worth of slack. Deriving the
 * threshold from the query turns it into a flat allowance instead — one typo
 * per five characters typed — which held across every labelled case tried.
 *
 * The cap keeps a long query from accumulating enough slack to go vague again.
 */
const CHARS_PER_ALLOWED_TYPO = 5;
const MAX_ALLOWED_TYPOS = 2;

/** Characters of context shown on each side of a body-text match. */
const SNIPPET_RADIUS = 70;

const COMBINING_MARKS = /\p{M}/gu;

/**
 * Kana voicing marks are combining marks, but they distinguish words rather
 * than decorate them: stripping them makes ガンダム (Gandamu) match カンタム
 * (Kantamu), which is a different word, not a different spelling of the same
 * one. Unlike an acute accent, no one omits a dakuten when typing.
 */
const KANA_VOICING = /[゙゚]/;

/**
 * Letters with no canonical decomposition, transliterated by hand.
 *
 * Ø is not O-with-a-stroke as far as Unicode is concerned — it's an atomic
 * letter, so NFKD leaves it alone and there's no mark to remove. The same goes
 * for the Polish ł, Croatian đ, and the ligatures. Handled here because a
 * reader who saw "Ørsted" on the page will type "orsted".
 */
const UNDECOMPOSED = /[øłđðþßæœıŧ]/g;
const UNDECOMPOSED_FOLDINGS: Record<string, string> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ı: 'i',
  ŧ: 't',
};

export interface SearchHit {
  entry: ArchiveEntry;
  /**
   * Context around the body-text match. Absent when the query matched only
   * metadata, or when the entry has no extracted text at all — without this
   * the user sees a row whose title has nothing to do with what they typed.
   */
  snippet?: Snippet;
}

export interface ArchiveSearcher {
  /** A blank query returns every entry, in the order given, with no snippets. */
  search(query: string): SearchHit[];
}

/**
 * Case- and accent-insensitive form of a string, for matching only.
 *
 * Decomposing splits a precomposed letter into its base plus combining marks,
 * so dropping the marks leaves the base letter: "ū" becomes "u", "é" becomes
 * "e". Without this, searching an article about Ryōma or Kotomine requires
 * reproducing the macron exactly — the accented and unaccented forms are
 * different code points, and indexOf never relates them.
 *
 * NFKD rather than NFD so compatibility forms fold to their plain equivalents:
 * full-width ＴＯＫＹＯ, the ﬁ ligature, and half-width katakana all normalize
 * to what a reader would actually type.
 *
 * Recomposing afterwards keeps the result close to the source in length, which
 * matters because the typo budget is derived from query length — a kana word
 * left decomposed would read as twice as long as it is.
 */
function fold(source: string): string {
  return source
    .normalize('NFKD')
    .replace(COMBINING_MARKS, (mark) => (KANA_VOICING.test(mark) ? mark : ''))
    .normalize('NFC')
    .toLowerCase()
    .replace(UNDECOMPOSED, (letter) => UNDECOMPOSED_FOLDINGS[letter]);
}

/**
 * Where a folded offset lands in the original text.
 *
 * Folding can change length — "ﬁ" is one character that lowercases to itself
 * but a standalone combining mark folds away to nothing — so an offset found
 * in folded text doesn't address the same character in the source. Snippets
 * are built from the source (the user should see the real accented text), so
 * the offset has to be translated back.
 *
 * Walked on demand rather than precomputed: an index map over every archived
 * article would cost more memory than the articles themselves, and this runs
 * only for entries that actually matched.
 */
function sourceOffsetOf(source: string, foldedOffset: number): number {
  let folded = 0;
  let index = 0;

  // Iterating by code point rather than code unit so surrogate pairs — emoji
  // and the like — advance as one character instead of being split.
  for (const char of source) {
    if (folded >= foldedOffset) return index;
    // ASCII carries no combining marks and always folds one-to-one, which is
    // most of any page; normalizing each character instead costs ~7x more.
    folded += char.charCodeAt(0) < 0x80 ? 1 : fold(char).length;
    index += char.length;
  }
  return source.length;
}

function thresholdFor(query: string): number {
  const allowedTypos = Math.min(
    Math.floor(query.length / CHARS_PER_ALLOWED_TYPO),
    MAX_ALLOWED_TYPOS,
  );
  return allowedTypos / query.length;
}

function parseTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * A window of text around a match, trimmed to whole words.
 *
 * Both edges are pulled back to a space so the snippet doesn't begin or end
 * mid-word, but never past the match itself — the matched term is the one
 * thing the snippet exists to show.
 */
function buildSnippet(text: string, matchIndex: number, matchLength: number): Snippet {
  const windowStart = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const windowEnd = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);

  let start = windowStart;
  if (windowStart > 0) {
    const space = text.indexOf(' ', windowStart);
    if (space !== -1 && space < matchIndex) start = space + 1;
  }

  let end = windowEnd;
  if (windowEnd < text.length) {
    const space = text.lastIndexOf(' ', windowEnd);
    if (space >= matchIndex + matchLength) end = space;
  }

  const leading = start > 0 ? '…' : '';
  const trailing = end < text.length ? '…' : '';

  return {
    text: `${leading}${text.slice(start, end)}${trailing}`,
    matchStart: matchIndex - start + leading.length,
    matchLength,
  };
}

/**
 * Body text matches only when EVERY term appears, so extra words narrow the
 * result set the way they do in any search box. The snippet is anchored to
 * whichever term appears earliest, since that's the most likely place the
 * terms occur together.
 */
function findBodyMatch(folded: string, source: string, terms: string[]): Snippet | undefined {
  let earliest = -1;
  let earliestLength = 0;

  for (const term of terms) {
    const index = folded.indexOf(term);
    if (index === -1) return undefined;
    if (earliest === -1 || index < earliest) {
      earliest = index;
      earliestLength = term.length;
    }
  }

  if (earliest === -1) return undefined;

  const start = sourceOffsetOf(source, earliest);
  const end = sourceOffsetOf(source, earliest + earliestLength);
  // A folded term can be shorter than the source it came from (one character
  // per stripped mark), so the length is measured in the source, not reused.
  return buildSnippet(source, start, Math.max(end - start, 1));
}

/** The searchable projection of an entry: folded metadata, keyed back to the entry. */
function toSearchDocument(entry: ArchiveEntry): Record<string, string> {
  return {
    id: entry.id,
    title: fold(entry.title),
    excerpt: fold(entry.excerpt ?? ''),
    siteName: fold(entry.siteName ?? ''),
    byline: fold(entry.byline ?? ''),
    url: fold(entry.url),
  };
}

/**
 * Builds the index once for a set of entries. Searching is then synchronous
 * and fast enough to run on every keystroke without debouncing.
 *
 * Folded body text is precomputed here rather than per search: folding the
 * whole corpus on each keystroke is the one part of this that would show up as
 * lag on a large archive.
 */
export function createArchiveSearcher(entries: ArchiveEntry[]): ArchiveSearcher {
  const documents = entries.map(toSearchDocument);

  // The threshold varies per query and is fixed at construction, so each search
  // needs its own Fuse. The index is the expensive part and is built once here;
  // the per-query instances reuse it.
  const metadataIndex = Fuse.createIndex(METADATA_KEYS, documents);

  const foldedText = entries.map((entry) => (entry.extractedText ? fold(entry.extractedText) : ''));

  return {
    search(query: string): SearchHit[] {
      const terms = parseTerms(query);
      if (terms.length === 0) return entries.map((entry) => ({ entry }));

      const foldedQuery = terms.join(' ');
      const fuse = new Fuse(
        documents,
        { keys: METADATA_KEYS, ignoreLocation: true, threshold: thresholdFor(foldedQuery) },
        metadataIndex,
      );

      // Fuse returns best-first; the position is the rank we sort by later.
      const metadataRank = new Map<string, number>();
      fuse.search(foldedQuery).forEach((result, rank) => metadataRank.set(result.item.id, rank));

      const metadataHits: SearchHit[] = [];
      const bodyOnlyHits: SearchHit[] = [];

      entries.forEach((entry, index) => {
        const source = entry.extractedText;
        const snippet = source ? findBodyMatch(foldedText[index], source, terms) : undefined;
        const rank = metadataRank.get(entry.id);

        if (rank === undefined) {
          // A body match still gets a snippet even when metadata also matched:
          // it shows *where* in the page the words appear.
          if (snippet) bodyOnlyHits.push({ entry, snippet });
          return;
        }
        metadataHits.push({ entry, snippet });
      });

      metadataHits.sort(
        (a, b) => (metadataRank.get(a.entry.id) ?? 0) - (metadataRank.get(b.entry.id) ?? 0),
      );

      // Metadata matches first — a hit on the title is a stronger signal than a
      // word buried in the body. Body-only hits keep the caller's order, which
      // is newest-first.
      return [...metadataHits, ...bodyOnlyHits];
    },
  };
}
