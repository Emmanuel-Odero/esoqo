import type { CounterBookInput } from './ParcelCounterTypes';

/**
 * Taking parcels in when the network isn't there.
 *
 * A counter in Kisumu at 7am on bad data still has customers. Every
 * other part of the product can reasonably say "try again" — an intake
 * desk cannot, because the alternative is turning a paying customer
 * away or writing on the back of an envelope.
 *
 * ── Why this is safe here and would not be elsewhere ──
 *
 * Replaying a queued booking must not create two parcels. Normally that
 * needs an idempotency key, a server-side dedupe table, and a policy
 * for what "the same request" means. None of that is needed here,
 * because pre-printed stock already provides it:
 *
 *   - the booking is bound to a specific pre-printed code;
 *   - core-go spends that code inside the same transaction as the
 *     insert, under `FOR UPDATE` (see BookParcel's existingCode path);
 *   - a second attempt therefore finds the label already used and is
 *     refused.
 *
 * So the code on the sticker IS the idempotency key, and it was minted
 * before the parcel existed. A replay that "fails" with "that label
 * isn't unused" has in fact succeeded — the parcel is there. That is
 * the one error this module treats as a win, and it is the whole reason
 * offline intake is honest rather than a hack.
 *
 * The direct consequence: **only bookings against an existing code can
 * be queued.** A booking that would mint a fresh code has no key, could
 * be replayed into duplicates, and is refused rather than risked.
 *
 * Shared by the Esoqo console counter and the courier-company counter
 * — the queueing contract is identical, only the submit function
 * differs (each portal's own booking action).
 */

const DB_NAME = 'esoqo-counter';
const STORE = 'pending-bookings';
const DB_VERSION = 1;

export interface QueuedBooking<T extends { existingCode?: string } = CounterBookInput> {
  /** The pre-printed code. Also the primary key, which is what makes
   *  queueing the same parcel twice a no-op rather than a duplicate. */
  code: string;
  input: T;
  queuedAt: number;
  /** Set after a flush attempt failed for a reason that wasn't the
   *  network — shown to the clerk rather than retried forever. */
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'code' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

/** Whether this browser can queue at all. Private-mode Safari and some
 *  locked-down installs have no IndexedDB, and a counter that silently
 *  believed it was queueing would be worse than one that admits it
 *  cannot. */
export function offlineSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function queueBooking<T extends { existingCode?: string }>(input: T): Promise<void> {
  if (!input.existingCode) {
    // Refused rather than risked — see this file's header on why the
    // pre-printed code is what makes a replay safe.
    throw new Error('Only a scanned label can be taken in offline.');
  }
  const entry: QueuedBooking<T> = {
    code: input.existingCode,
    input,
    queuedAt: Date.now(),
  };
  await tx('readwrite', (s) => s.put(entry));
}

export async function listQueued<T extends { existingCode?: string } = CounterBookInput>(): Promise<QueuedBooking<T>[]> {
  if (!offlineSupported()) return [];
  try {
    const all = await tx<QueuedBooking<T>[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedBooking<T>[]>);
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

async function remove(code: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(code) as unknown as IDBRequest<undefined>);
}

async function markFailed<T extends { existingCode?: string }>(entry: QueuedBooking<T>, error: string): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...entry, lastError: error }));
}

export interface FlushResult {
  synced: string[];
  /** Still queued, with why. A network failure leaves no message — it
   *  will simply be retried. */
  stuck: { code: string; error: string }[];
}

/**
 * Send everything queued, oldest first.
 *
 * `submit` is injected rather than imported so this module stays
 * free of server-action wiring; each counter passes its own booking
 * action (admin or company).
 *
 * The subtle case is the middle branch. "That label code isn't a known,
 * unused pre-printed label" means the code was already spent — which,
 * for a queued booking, almost always means our own earlier attempt
 * reached the server and we never saw the reply. Dropping it is
 * correct: retrying forever would leave the clerk staring at a failure
 * for a parcel that shipped hours ago.
 *
 * The risk we accept: if that code had genuinely been used by someone
 * else, this silently discards the offline record. Pre-printed stock
 * makes that nearly impossible — the sticker is physically in one
 * person's hand — and the alternative (a permanent stuck item nobody
 * can clear) is worse at a counter.
 */
export async function flushQueue<T extends { existingCode?: string }>(
  submit: (input: T) => Promise<{ ok: true; code: string } | { ok: false; error: string }>,
): Promise<FlushResult> {
  const result: FlushResult = { synced: [], stuck: [] };
  if (!offlineSupported()) return result;

  for (const entry of await listQueued<T>()) {
    let res: Awaited<ReturnType<typeof submit>>;
    try {
      res = await submit(entry.input);
    } catch {
      // Still offline. Leave it queued, say nothing, try again later.
      result.stuck.push({ code: entry.code, error: '' });
      continue;
    }
    if (res.ok) {
      await remove(entry.code);
      result.synced.push(entry.code);
      continue;
    }
    if (alreadySpent(res.error)) {
      await remove(entry.code);
      result.synced.push(entry.code);
      continue;
    }
    // A real rejection — a voided pad, another company's stock, a
    // validation failure. Retrying will not fix it, so surface it.
    await markFailed(entry, res.error);
    result.stuck.push({ code: entry.code, error: res.error });
  }
  return result;
}

/** Matched on core-go's own wording for a spent code. Brittle by
 *  nature; kept to one place so it is one line to fix, and the failure
 *  mode of a miss is a visible stuck item rather than a lost parcel. */
function alreadySpent(error: string): boolean {
  return /unused pre-printed label/i.test(error);
}
