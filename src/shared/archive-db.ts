import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ArchiveEntry } from './types';

const DB_NAME = 'tab-review-archive';
const DB_VERSION = 1;
const STORE = 'archives';

interface ArchiveDBSchema extends DBSchema {
  [STORE]: {
    key: string;
    value: ArchiveEntry;
    indexes: {
      'by-archived-at': number;
      'by-url': string;
    };
  };
}

/** Archive input before the store assigns identity and capture time. */
export type NewArchiveEntry = Omit<ArchiveEntry, 'id' | 'archivedAt'>;

let dbPromise: Promise<IDBPDatabase<ArchiveDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<ArchiveDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ArchiveDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Upgrades are cumulative and run in order for whatever version the
        // user is actually on, so a future version appends a block below
        // rather than editing the ones above it.
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by-archived-at', 'archivedAt');
          // Unique because the dedupe policy is one entry per URL; addArchiveEntry
          // upholds it by reusing the existing row's id inside the same transaction.
          store.createIndex('by-url', 'url', { unique: true });
        }
      },
    });
  }
  return dbPromise;
}

let lastAssignedArchivedAt = 0;

/**
 * Date.now() with a guarantee that it strictly increases.
 *
 * Entries archived in the same millisecond would otherwise tie on the
 * by-archived-at index and come back in arbitrary order — which a bulk
 * "archive everything stale" action would hit constantly, since it writes
 * many entries in one burst.
 */
function nextArchivedAt(): number {
  const now = Date.now();
  lastAssignedArchivedAt = now > lastAssignedArchivedAt ? now : lastAssignedArchivedAt + 1;
  return lastAssignedArchivedAt;
}

/**
 * Store a capture, overwriting any existing entry for the same URL.
 *
 * The lookup and the write share one readwrite transaction so two concurrent
 * archives of the same URL can't both observe "no existing row" and then race
 * to insert two entries.
 */
export async function addArchiveEntry(input: NewArchiveEntry): Promise<ArchiveEntry> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const existing = await tx.store.index('by-url').get(input.url);

  const entry: ArchiveEntry = {
    ...input,
    id: existing?.id ?? crypto.randomUUID(),
    archivedAt: nextArchivedAt(),
  };

  await tx.store.put(entry);
  await tx.done;
  return entry;
}

/** All entries, most recently archived first. */
export async function getAllArchiveEntries(): Promise<ArchiveEntry[]> {
  const db = await getDb();
  const ascending = await db.getAllFromIndex(STORE, 'by-archived-at');
  return ascending.reverse();
}

export async function getArchiveEntryByUrl(url: string): Promise<ArchiveEntry | undefined> {
  const db = await getDb();
  return db.getFromIndex(STORE, 'by-url', url);
}

export async function deleteArchiveEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function countArchiveEntries(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

/**
 * Drop the cached connection. Needed in tests between cases, and lets a
 * caller release the handle so a pending version upgrade isn't blocked.
 */
export async function closeArchiveDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}
