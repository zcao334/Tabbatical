// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  isArticleLike,
  linkDensity,
  LINK_DENSITY_LIMIT,
  MIN_ARTICLE_TEXT_LENGTH,
} from './article-quality';

function fragment(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder;
}

/** Stand-in for the nav menu Readability returns on a news homepage. */
const NAV_SOUP = fragment(
  Array.from({ length: 40 }, (_, i) => `<a href="/s${i}">Section Name ${i}</a>`).join(' '),
);

/** Ordinary article markup: prose, with a couple of inline links. */
const ARTICLE = fragment(
  `<p>${'Gun rights advocates put a federal court victory into action. '.repeat(8)}</p>
   <p>See also <a href="/x">an earlier report</a> for background.</p>
   <p>${'The ruling appears poised to stand without a challenge. '.repeat(8)}</p>`,
);

describe('linkDensity', () => {
  it('reports near-total density for a block of nothing but links', () => {
    expect(linkDensity(NAV_SOUP)).toBeGreaterThan(0.9);
  });

  it('reports low density for prose with a few inline links', () => {
    expect(linkDensity(ARTICLE)).toBeLessThan(0.2);
  });

  it('returns 0 for empty content rather than treating it as all links', () => {
    expect(linkDensity(fragment(''))).toBe(0);
    expect(linkDensity(fragment('<div>   </div>'))).toBe(0);
  });

  it('clamps to 1 when nested anchors would otherwise double-count', () => {
    expect(linkDensity(fragment('<a href="/a">outer <a href="/b">inner</a></a>'))).toBeLessThanOrEqual(1);
  });
});

describe('isArticleLike', () => {
  it('rejects navigation even when it is long', () => {
    const text = NAV_SOUP.textContent ?? '';
    expect(text.length).toBeGreaterThan(MIN_ARTICLE_TEXT_LENGTH);
    expect(isArticleLike(NAV_SOUP, text)).toBe(false);
  });

  it('accepts a normal article', () => {
    expect(isArticleLike(ARTICLE, ARTICLE.textContent ?? '')).toBe(true);
  });

  it('rejects content too short to be worth calling full text', () => {
    const stub = fragment('<p>Three words here.</p>');
    expect(isArticleLike(stub, stub.textContent ?? '')).toBe(false);
  });

  it('judges length on the stored text, which may be truncated', () => {
    // Long enough markup, but the text actually being stored is not.
    expect(isArticleLike(ARTICLE, 'too short')).toBe(false);
  });

  it('accepts content sitting exactly at the density limit', () => {
    // 50 chars of link text inside 100 chars total.
    const half = fragment(`<a href="/a">${'x'.repeat(50)}</a>${'y'.repeat(50)}`);
    expect(linkDensity(half)).toBeCloseTo(LINK_DENSITY_LIMIT, 5);
    expect(isArticleLike(half, 'z'.repeat(MIN_ARTICLE_TEXT_LENGTH))).toBe(true);
  });
});
