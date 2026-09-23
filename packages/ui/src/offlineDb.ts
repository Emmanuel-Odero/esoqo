/**
 * The one IndexedDB database the offline surfaces share, and the one
 * place its version is bumped.
 *
 * Two modules queue work offline — counter intake (parcelOfflineQueue)
 * and custody events (custodyQueue) — and they must not each call
 * indexedDB.open() with their own idea of the version. Two openers
 * disagreeing by one version is a `VersionError` on whichever loses,
 * and it surfaces as a desk that silently stops queueing: the worst
 * possible failure for the feature whose entire job is to keep working
 * when nothing else does.
 *
 * So the schema lives here, every store is created in one
 * onupgradeneeded, and adding a store means bumping DB_VERSION in this
 * file and nowhere else.
 */

const DB_NAME = 'esoqo-counter';

/** Every object store, created together.
 *
 *  v1 shipped with pending-bookings alone. v2 adds pending-custody. An
 *  upgrade is additive — a counter open across the deploy keeps
 *  whatever it had queued, which matters because those rows are parcels
 *  somebody is holding.
 *
 *  There is deliberately no photo store yet. Queueing intake/POD images
 *  is a real gap, but it belongs where the capture is: POD photos are
 *  taken in the Flutter app (features/parcels/complete_delivery_screen
 *  .dart), which has no offline layer at all, and intake photos are not
 *  captured anywhere — parcel."intakePhotoUrl" has no writer outside
 *  the schema. A store here would serve neither. Add it in the same
 *  change that gives it something to hold. */
export const STORE_BOOKINGS = 'pending-bookings';
export const STORE_CUSTODY = 'pending-custody';

const DB_VERSION = 2;

/** Whether this browser can queue at all. Private-mode Safari and some
 *  locked-down installs have no IndexedDB, and a counter that silently
 *  believed it was queueing would be worse than one that admits it
 *  cannot. */
export function offlineSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // keyPath differs per store because each has its own natural key —
      // see each queue module for why that key makes a replay safe.
      if (!db.objectStoreNames.contains(STORE_BOOKINGS)) {
        db.createObjectStore(STORE_BOOKINGS, { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains(STORE_CUSTODY)) {
        db.createObjectStore(STORE_CUSTODY, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}
