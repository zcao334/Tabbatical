/**
 * Quality gate for Readability output.
 *
 * Readability never reports failure — given a page with no article it falls
 * back to whichever block holds the most text. On a news homepage that block
 * is the nav menu, which comes back as a wall of section names that reads as
 * "full text" to anything downstream. isProbablyReaderable doesn't catch it
 * either: its heuristic counts sizeable text nodes, and a homepage packed
 * with headline teasers clears that bar.
 *
 * What actually separates the two is what the text is made of. Navigation is
 * almost entirely anchor text; article prose is almost entirely not. That
 * ratio is a far sharper signal than length or node count.
 *
 * Kept DOM-generic (ParentNode, not Document) so it runs against Readability's
 * parsed output in the page and against a jsdom tree under test.
 */

/**
 * Above this share of link text, treat the extraction as navigation.
 *
 * Nav blocks measure ~0.9-1.0. Real articles sit well under 0.3 even when
 * heavily cross-linked, so 0.5 rejects link soup with a wide margin before it
 * risks a genuine article.
 */
export const LINK_DENSITY_LIMIT = 0.5;

/**
 * Shorter than this isn't worth calling full text. Deliberately low — some
 * legitimate posts are only a paragraph, and the link-density check is what
 * does the real work here.
 */
export const MIN_ARTICLE_TEXT_LENGTH = 200;

function textLengthOf(node: { textContent: string | null }): number {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

/**
 * Share of this subtree's text that sits inside links, from 0 to 1.
 *
 * Returns 0 for empty content so a caller can't read "no text" as "all links".
 */
export function linkDensity(root: ParentNode & { textContent: string | null }): number {
  const total = textLengthOf(root);
  if (total === 0) return 0;

  // Indexed rather than for..of: NodeList isn't iterable under this
  // tsconfig's lib set, and widening it for one loop isn't worth it.
  const anchors = root.querySelectorAll('a');
  let linked = 0;
  for (let i = 0; i < anchors.length; i++) {
    linked += textLengthOf(anchors[i]);
  }

  // Nested anchors could double-count past the total; clamp so the result
  // stays a usable ratio.
  return Math.min(linked / total, 1);
}

/**
 * Whether extracted content reads as an article rather than navigation.
 *
 * `text` is the normalized plain text actually being stored, which may be
 * truncated relative to `root` — length is judged on what gets stored, link
 * density on the full parsed markup.
 */
export function isArticleLike(
  root: ParentNode & { textContent: string | null },
  text: string,
): boolean {
  if (text.length < MIN_ARTICLE_TEXT_LENGTH) return false;
  return linkDensity(root) <= LINK_DENSITY_LIMIT;
}
