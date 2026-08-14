import { describe, expect, it } from 'vitest';
import { buildArchiveEntry } from './archive';
import type { ExtractionOutcome } from './extraction';

const tab = {
  url: 'https://example.com/article',
  title: 'Tab Title',
  favIconUrl: 'https://example.com/favicon.ico',
};

/** Every outcome that isn't a declined permission must still yield an entry. */
const METADATA_ONLY_OUTCOMES: ExtractionOutcome[] = [
  { status: 'empty' },
  { status: 'discarded' },
  { status: 'unsupported' },
  { status: 'failed' },
];

describe('buildArchiveEntry', () => {
  it('keeps extracted content and prefers the article title', () => {
    const entry = buildArchiveEntry(tab, {
      status: 'extracted',
      content: {
        title: 'Article Title',
        byline: 'A. Writer',
        siteName: 'Example',
        excerpt: 'A summary.',
        textContent: 'The body text.',
      },
    });

    expect(entry).toMatchObject({
      url: tab.url,
      title: 'Article Title',
      hasFullText: true,
      extractedText: 'The body text.',
      byline: 'A. Writer',
      siteName: 'Example',
      excerpt: 'A summary.',
      faviconUrl: tab.favIconUrl,
    });
  });

  it.each(METADATA_ONLY_OUTCOMES)('archives metadata-only on $status', (outcome) => {
    const entry = buildArchiveEntry(tab, outcome);

    expect(entry).not.toBeNull();
    expect(entry?.hasFullText).toBe(false);
    expect(entry?.extractedText).toBeUndefined();
    // Metadata still has to be useful enough to find the page again later.
    expect(entry?.title).toBe('Tab Title');
    expect(entry?.url).toBe(tab.url);
    expect(entry?.faviconUrl).toBe(tab.favIconUrl);
  });

  it('falls back to the page favicon when Chrome reports none', () => {
    const entry = buildArchiveEntry(
      { ...tab, favIconUrl: undefined },
      { status: 'extracted', content: { faviconUrl: 'https://example.com/page-icon.png' } },
    );

    expect(entry?.faviconUrl).toBe('https://example.com/page-icon.png');
  });

  it("prefers Chrome's favicon over the page's when both are present", () => {
    const entry = buildArchiveEntry(tab, {
      status: 'extracted',
      content: { faviconUrl: 'https://example.com/page-icon.png' },
    });

    expect(entry?.faviconUrl).toBe(tab.favIconUrl);
  });

  it('treats a blank favIconUrl as absent rather than storing whitespace', () => {
    const entry = buildArchiveEntry(
      { ...tab, favIconUrl: '   ' },
      { status: 'extracted', content: { faviconUrl: 'https://example.com/page-icon.png' } },
    );

    expect(entry?.faviconUrl).toBe('https://example.com/page-icon.png');
  });

  it('treats an extraction with no text as metadata-only', () => {
    const entry = buildArchiveEntry(tab, {
      status: 'extracted',
      content: { title: 'Article Title', excerpt: 'A summary.' },
    });

    expect(entry?.hasFullText).toBe(false);
  });

  it('falls back to the tab title, then the URL, when no title is available', () => {
    expect(buildArchiveEntry({ ...tab, title: '  ' }, { status: 'failed' })?.title).toBe(tab.url);
    expect(buildArchiveEntry({ ...tab, title: undefined }, { status: 'failed' })?.title).toBe(
      tab.url,
    );
  });

  it('refuses a tab with no URL, which has nothing worth storing', () => {
    expect(buildArchiveEntry({ ...tab, url: undefined }, { status: 'failed' })).toBeNull();
    expect(buildArchiveEntry({ ...tab, url: '' }, { status: 'extracted', content: {} })).toBeNull();
  });

  it('archives a chrome:// page as metadata-only rather than failing', () => {
    const entry = buildArchiveEntry(
      { url: 'chrome://extensions', title: 'Extensions', favIconUrl: undefined },
      { status: 'unsupported' },
    );

    expect(entry).toEqual({
      url: 'chrome://extensions',
      title: 'Extensions',
      hasFullText: false,
      faviconUrl: undefined,
      extractedText: undefined,
      excerpt: undefined,
      byline: undefined,
      siteName: undefined,
    });
  });
});
