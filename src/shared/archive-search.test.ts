import { describe, expect, it } from 'vitest';
import { createArchiveSearcher } from './archive-search';
import type { ArchiveEntry } from './types';

function entry(overrides: Partial<ArchiveEntry> & Pick<ArchiveEntry, 'id'>): ArchiveEntry {
  return {
    url: `https://example.com/${overrides.id}`,
    title: `Entry ${overrides.id}`,
    archivedAt: 1,
    hasFullText: true,
    ...overrides,
  };
}

const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod '.repeat(400);

describe('createArchiveSearcher', () => {
  it('returns every entry, in order, for a blank query', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })];
    const hits = createArchiveSearcher(entries).search('   ');

    expect(hits.map((h) => h.entry.id)).toEqual(['a', 'b']);
    expect(hits.every((h) => h.snippet === undefined)).toBe(true);
  });

  it('finds a keyword that appears only in body text', () => {
    // The issue's headline acceptance criterion.
    const entries = [
      entry({ id: 'unrelated', title: 'Something else', extractedText: 'nothing of interest' }),
      entry({ id: 'match', title: 'A recipe', extractedText: 'fold the flour into the batter' }),
    ];

    const hits = createArchiveSearcher(entries).search('batter');
    expect(hits.map((h) => h.entry.id)).toEqual(['match']);
  });

  it('finds a keyword buried deep in a long article', () => {
    // Regression test for Fuse's `distance: 100` default, which only matches
    // near the start of a field and missed 4 of 5 planted needles in benchmarks.
    const entries = [
      entry({ id: 'deep', title: 'Untitled', extractedText: `${FILLER} zephyrhunter ${FILLER}` }),
    ];

    expect(createArchiveSearcher(entries).search('zephyrhunter')).toHaveLength(1);
  });

  it('does not match unrelated articles on a body-text query', () => {
    // Fuzzy matching across full prose found "inflation" in a baking article;
    // body text is matched exactly for precisely this reason.
    const entries = [
      entry({ id: 'cooking', title: 'Baking', extractedText: 'whisk butter and sugar until pale' }),
      entry({ id: 'finance', title: 'Markets', extractedText: 'persistent inflation in services' }),
    ];

    const hits = createArchiveSearcher(entries).search('inflation');
    expect(hits.map((h) => h.entry.id)).toEqual(['finance']);
  });

  describe('fuzzy metadata matching', () => {
    // Modelled on a real archive: pages about Fate alongside unrelated news.
    const realistic = [
      entry({ id: 'gsearch-fate', title: 'fate/save - Google Search', siteName: 'Google' }),
      entry({ id: 'shipfu', title: 'Fate/Save Calculator', url: 'https://shipfu.moe/' }),
      entry({ id: 'wikipedia', title: 'Fate/Grand Order – Absolute Demonic Front: Babylonia' }),
      entry({ id: 'mvc', title: 'marvel vs capcom 3 fate of two worlds - Google Search' }),
      entry({ id: 'aerial', title: 'Aerial Drive', url: 'https://fategrandorder.fandom.com/wiki/x' }),
      entry({
        id: 'gunrights',
        title: 'Gun rights groups capitalize after judge reverses ruling',
        url: 'https://www.foxnews.com/politics/gun-rights-groups',
        siteName: 'Fox News',
      }),
      entry({ id: 'foxhome', title: 'Fox News - Breaking News Updates', url: 'https://www.foxnews.com/' }),
      entry({ id: 'garden', title: 'Winter garden preparation' }),
    ];

    const search = (query: string) =>
      createArchiveSearcher(realistic)
        .search(query)
        .map((hit) => hit.entry.id)
        .sort();

    const FATE_PAGES = ['aerial', 'gsearch-fate', 'mvc', 'shipfu', 'wikipedia'];

    it('matches every page about a term and nothing else', () => {
      expect(search('fate')).toEqual(FATE_PAGES);
    });

    it('still matches them through a typo', () => {
      expect(search('fatge')).toEqual(FATE_PAGES);
    });

    it('does not let a typo drag in unrelated pages', () => {
      // Regression: at a fixed 0.4 threshold "fatge" also returned both Fox
      // News pages, because the allowance scaled with the field, not the query.
      expect(search('fatge')).not.toContain('gunrights');
      expect(search('fatge')).not.toContain('foxhome');
    });

    it('tolerates a typo in a longer word', () => {
      expect(search('wikipeda')).toEqual(['wikipedia']);
      expect(search('gardne')).toEqual(['garden']);
    });

    it('keeps short queries exact, where fuzziness has no room to be precise', () => {
      expect(search('gun')).toEqual(['gunrights']);
    });

    it('matches within a URL', () => {
      expect(search('foxnews')).toEqual(['foxhome', 'gunrights']);
    });
  });

  it('matches case-insensitively in body text', () => {
    const entries = [entry({ id: 'a', extractedText: 'The Servant Roster' })];

    expect(createArchiveSearcher(entries).search('SERVANT')).toHaveLength(1);
  });

  it('requires every term of a multi-word body query', () => {
    const entries = [
      entry({ id: 'both', title: 'x', extractedText: 'the judge issued a ruling today' }),
      entry({ id: 'one', title: 'y', extractedText: 'the judge went home' }),
    ];

    const hits = createArchiveSearcher(entries).search('judge ruling');
    expect(hits.map((h) => h.entry.id)).toEqual(['both']);
  });

  it('ranks metadata matches above body-only matches', () => {
    const entries = [
      entry({ id: 'body', title: 'Unrelated heading', extractedText: 'a passing mention of otters' }),
      entry({ id: 'title', title: 'Otters of the Pacific' }),
    ];

    const hits = createArchiveSearcher(entries).search('otters');
    expect(hits.map((h) => h.entry.id)).toEqual(['title', 'body']);
  });

  it('handles metadata-only entries, which have no text to scan', () => {
    const entries = [entry({ id: 'meta', title: 'New Tab', hasFullText: false })];

    expect(createArchiveSearcher(entries).search('anything')).toEqual([]);
    expect(createArchiveSearcher(entries).search('New Tab')).toHaveLength(1);
  });

  describe('accents and case folding', () => {
    // Romanized Japanese is all over the archived FGO pages, so macrons are
    // routine: requiring the exact code point would mean the text is only
    // findable by someone who can type it.
    const accented = [
      entry({
        id: 'ryoma',
        title: 'Sakamoto Ryōma',
        extractedText: 'The Ōoku was closed. Ryōma travelled by night.',
      }),
      entry({ id: 'cafe', title: 'Café culture', extractedText: 'a naïve résumé' }),
    ];
    const search = (query: string) =>
      createArchiveSearcher(accented)
        .search(query)
        .map((hit) => hit.entry.id);

    it('matches an unaccented query against accented text', () => {
      expect(search('ryoma')).toEqual(['ryoma']);
      expect(search('ooku')).toEqual(['ryoma']);
      expect(search('resume')).toEqual(['cafe']);
    });

    it('matches an accented query against the same text', () => {
      expect(search('Ryōma')).toEqual(['ryoma']);
    });

    it('matches an accented query against unaccented text', () => {
      const plain = [entry({ id: 'plain', title: 'x', extractedText: 'the ooku records' })];
      expect(createArchiveSearcher(plain).search('Ōoku')).toHaveLength(1);
    });

    it('folds accents in metadata too', () => {
      expect(search('cafe')).toEqual(['cafe']);
    });

    it('highlights the accented source text, not the folded form', () => {
      // Offsets are found in folded text but must address the original, which
      // is what the user sees.
      const [hit] = createArchiveSearcher(accented).search('ryoma');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('Ryōma');
    });

    it('keeps offsets correct when accents precede the match', () => {
      const entries = [
        entry({ id: 'a', title: 'x', extractedText: 'Ōoku Ryōma Kotomine zephyrhunter tail' }),
      ];
      const [hit] = createArchiveSearcher(entries).search('zephyrhunter');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('zephyrhunter');
    });

    it('folds letters that have no canonical decomposition', () => {
      // Ø is an atomic letter, not O-with-a-stroke, so nothing decomposes.
      const entries = [
        entry({ id: 'orsted', title: 'Ørsted', extractedText: 'Hans Christian Ørsted' }),
        entry({ id: 'lodz', title: 'Łódź', extractedText: 'a city in Poland' }),
        entry({ id: 'strasse', title: 'Straße', extractedText: 'Bahnhofstraße 12' }),
        entry({ id: 'dorde', title: 'Đorđe', extractedText: 'a given name' }),
        entry({ id: 'aether', title: 'Æther', extractedText: 'the fifth element' }),
      ];
      const search = (query: string) =>
        createArchiveSearcher(entries)
          .search(query)
          .map((hit) => hit.entry.id);

      expect(search('orsted')).toContain('orsted');
      expect(search('lodz')).toContain('lodz');
      expect(search('strasse')).toContain('strasse');
      expect(search('dorde')).toContain('dorde');
      expect(search('aether')).toContain('aether');
    });

    it('folds full-width and ligature forms to what a reader would type', () => {
      const entries = [
        entry({ id: 'tokyo', title: 'ＴＯＫＹＯ', extractedText: 'ＴＯＫＹＯ ２０２５' }),
        entry({ id: 'final', title: 'x', extractedText: 'the ﬁnal chapter' }),
      ];
      const search = (query: string) =>
        createArchiveSearcher(entries)
          .search(query)
          .map((hit) => hit.entry.id);

      expect(search('tokyo')).toContain('tokyo');
      expect(search('final')).toContain('final');
    });

    describe('kana voicing marks', () => {
      // Dakuten are combining marks, but they distinguish words rather than
      // decorate them, so they survive folding while accents do not.
      const kana = [
        entry({ id: 'gundam', title: 'ガンダム', extractedText: 'ガンダムの機体' }),
        entry({ id: 'kantamu', title: 'カンタム', extractedText: 'カンタムは別の言葉' }),
      ];
      const search = (query: string) =>
        createArchiveSearcher(kana)
          .search(query)
          .map((hit) => hit.entry.id);

      it('keeps voiced and unvoiced kana distinct', () => {
        expect(search('ガンダム')).toEqual(['gundam']);
        expect(search('カンタム')).toEqual(['kantamu']);
      });

      it('still matches half-width kana against full-width', () => {
        expect(search('ｶﾞﾝﾀﾞﾑ')).toEqual(['gundam']);
      });
    });

    it('handles text outside the BMP without splitting surrogate pairs', () => {
      const entries = [entry({ id: 'a', title: 'x', extractedText: '🎉🎉🎉 zephyrhunter here' })];
      const [hit] = createArchiveSearcher(entries).search('zephyrhunter');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('zephyrhunter');
    });
  });

  describe('snippets', () => {
    it('marks the matched term at the reported offsets', () => {
      const entries = [entry({ id: 'a', title: 'x', extractedText: 'fold the flour in gently' })];
      const [hit] = createArchiveSearcher(entries).search('flour');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('flour');
    });

    it('keeps offsets correct once the snippet is elided at the front', () => {
      const entries = [entry({ id: 'a', title: 'x', extractedText: `${FILLER} zephyrhunter end` })];
      const [hit] = createArchiveSearcher(entries).search('zephyrhunter');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.startsWith('…')).toBe(true);
      expect(text.slice(matchStart, matchStart + matchLength)).toBe('zephyrhunter');
    });

    it('never truncates the matched term when trimming to word boundaries', () => {
      // Both edges get pulled back to a space; neither may cross the match.
      const entries = [
        entry({ id: 'a', title: 'x', extractedText: `${FILLER}zephyrhunter${FILLER}` }),
      ];
      const [hit] = createArchiveSearcher(entries).search('zephyrhunter');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('zephyrhunter');
    });

    it('omits the leading ellipsis when the match is at the very start', () => {
      const entries = [entry({ id: 'a', title: 'x', extractedText: 'flour is the first word' })];
      const [hit] = createArchiveSearcher(entries).search('flour');

      expect(hit.snippet!.text.startsWith('…')).toBe(false);
      expect(hit.snippet!.matchStart).toBe(0);
    });

    it('anchors the snippet to whichever term appears earliest', () => {
      const entries = [
        entry({ id: 'a', title: 'x', extractedText: 'ruling came first, judge came later' }),
      ];
      const [hit] = createArchiveSearcher(entries).search('judge ruling');
      const { text, matchStart, matchLength } = hit.snippet!;

      expect(text.slice(matchStart, matchStart + matchLength)).toBe('ruling');
    });

    it('gives no snippet when only metadata matched', () => {
      const entries = [entry({ id: 'a', title: 'Otters', extractedText: 'unrelated body' })];
      const [hit] = createArchiveSearcher(entries).search('otters');

      expect(hit.snippet).toBeUndefined();
    });
  });
});
