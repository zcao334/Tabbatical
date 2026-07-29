// Node has no IndexedDB, so this shims the globals before archive-db loads.
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addArchiveEntry,
  closeArchiveDb,
  countArchiveEntries,
  deleteArchiveEntry,
  getAllArchiveEntries,
  getArchiveEntryByUrl,
  type NewArchiveEntry,
} from './archive-db';

function makeEntry(overrides: Partial<NewArchiveEntry> = {}): NewArchiveEntry {
  return {
    url: 'https://example.com/article',
    title: 'An Article',
    hasFullText: true,
    extractedText: 'body text',
    ...overrides,
  };
}

afterEach(async () => {
  await closeArchiveDb();
  await deleteDB('tab-review-archive');
});

describe('archive-db', () => {
  it('round-trips an entry, assigning an id and archivedAt', async () => {
    const saved = await addArchiveEntry(makeEntry());

    expect(saved.id).toBeTruthy();
    expect(saved.archivedAt).toBeGreaterThan(0);
    expect(await getArchiveEntryByUrl('https://example.com/article')).toEqual(saved);
  });

  // Guards the strictly-increasing archivedAt: these three writes land in the
  // same millisecond, which is exactly what a bulk archive would do.
  it('returns entries newest-first', async () => {
    const first = await addArchiveEntry(makeEntry({ url: 'https://example.com/1' }));
    const second = await addArchiveEntry(makeEntry({ url: 'https://example.com/2' }));
    const third = await addArchiveEntry(makeEntry({ url: 'https://example.com/3' }));

    const ids = (await getAllArchiveEntries()).map((entry) => entry.id);
    expect(ids).toEqual([third.id, second.id, first.id]);
  });

  it('overwrites rather than duplicating when the same URL is archived twice', async () => {
    const original = await addArchiveEntry(makeEntry({ title: 'First capture' }));
    const recapture = await addArchiveEntry(makeEntry({ title: 'Second capture' }));

    expect(await countArchiveEntries()).toBe(1);
    expect(recapture.id).toBe(original.id);
    expect((await getArchiveEntryByUrl(makeEntry().url))?.title).toBe('Second capture');
  });

  it('keeps one row per URL when the same URL is archived concurrently', async () => {
    await Promise.all([
      addArchiveEntry(makeEntry({ title: 'A' })),
      addArchiveEntry(makeEntry({ title: 'B' })),
    ]);

    expect(await countArchiveEntries()).toBe(1);
  });

  it('deletes an entry by id', async () => {
    const saved = await addArchiveEntry(makeEntry());
    await deleteArchiveEntry(saved.id);

    expect(await countArchiveEntries()).toBe(0);
    expect(await getArchiveEntryByUrl(saved.url)).toBeUndefined();
  });

  it('persists metadata-only entries without content fields', async () => {
    const saved = await addArchiveEntry({
      url: 'chrome://extensions',
      title: 'Extensions',
      hasFullText: false,
    });

    const loaded = await getArchiveEntryByUrl('chrome://extensions');
    expect(loaded?.hasFullText).toBe(false);
    expect(loaded?.extractedText).toBeUndefined();
    expect(loaded?.id).toBe(saved.id);
  });

  it('reopens an existing database without re-running the upgrade', async () => {
    const saved = await addArchiveEntry(makeEntry());
    await closeArchiveDb();

    // Data written before the connection closed must survive reopening.
    expect(await getArchiveEntryByUrl(saved.url)).toEqual(saved);
  });
});
