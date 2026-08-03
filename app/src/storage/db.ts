import type { Separation, Song } from '../domain/types.ts';

const DB_NAME = 'gerson';
const DB_VERSION = 2; // v2: Separation.durationSec field added (no structural change)

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('separations')) {
        db.createObjectStore('separations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const txn = db.transaction(storeName, mode);
  return idbRequest(fn(txn.objectStore(storeName)));
}

export async function getSeparation(id: string): Promise<Separation | undefined> {
  return withStore('separations', 'readonly', s => s.get(id));
}

export async function putSeparation(sep: Separation): Promise<void> {
  await withStore('separations', 'readwrite', s => s.put(sep));
}

export async function getAllSeparations(): Promise<Separation[]> {
  return withStore('separations', 'readonly', s => s.getAll());
}

export async function getSong(id: string): Promise<Song | undefined> {
  return withStore('songs', 'readonly', s => s.get(id));
}

export async function getAllSongs(): Promise<Song[]> {
  return withStore('songs', 'readonly', s => s.getAll());
}

// OPFS files (stems + peaks) must be written before this call.
// A crash between the two leaves orphaned bytes but no songs row.
export async function commitSeparationToSong(id: string, song: Song): Promise<void> {
  const db = await openDb();
  const txn = db.transaction(['separations', 'songs'], 'readwrite');
  txn.objectStore('separations').delete(id);
  txn.objectStore('songs').put(song);
  return new Promise<void>((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}
