import { offlineSupported, STORE_CUSTODY, tx } from './offlineDb';

/**
 * Custody events, queued when the network isn't there.
 *
 * The counter already survives an outage (parcelOfflineQueue) — but the
 * counter usually has the better connection. Everything that happens to
 * a parcel or a bag *after* the desk happens on a road: a handoff at a
 * stage, a box going into a boot, a bag coming out of one, a delivery
 * at a door. Those are the moments with no signal, and until this
 * existed they were the moments with no queue.
 *
 * What that cost, concretely: a conductor whose scan fails at a stage
 * at 21:40 does what people do — hands the box over and moves on. The
 * parcel then lives in the data as still-on-the-bus, and every claim
 * downstream (turnaround time, the custody chain, the photo pair that
 * settles a damage dispute) is void for that parcel while the console
 * reports it confidently.
 *
 * ── Why replaying these is safe ──
 *
 * The booking queue leans on the pre-printed code being a natural
 * idempotency key. Custody events have a stronger property: they are
 * *state transitions on a row that already exists*, and the server
 * already refuses an illegal one.
 *
 *   - ParcelHandoff is append-only and NextHandoffStatus decides what
 *     transition is legal from where;
 *   - BoardLuggage returns the tag unchanged when it is already ABOARD;
 *   - ClaimLuggage returns the claim when it is already CLAIMED.
 *
 * So replaying "board LUG-X" onto an already-boarded bag is a no-op
 * rather than a duplicate, and the key is (code, intent) rather than
 * anything the client has to invent. Queueing the same intent twice
 * overwrites one row instead of creating two — which is also exactly
 * what should happen when a conductor scans the same tag twice because
 * the first beep was lost in traffic.
 *
 * ── What is deliberately NOT queued ──
 *
 * Anything whose outcome the crew must see before acting. A claim
 * override needs a human decision recorded against a reason, and a
 * claim's whole value is the "one more still aboard" answer that comes
 * back — queueing it would hand back a cheerful tick and no sibling
 * count, which is worse than telling the truth and waiting. Those stay
 * online-only and say so.
 */

/** What kind of custody move this is. The string is half the key, so it
 *  is a closed set rather than free text: two different spellings of
 *  the same intent would queue as two rows and replay twice. */
export type CustodyIntent =
  | 'parcel.receive'
  | 'parcel.handoff'
  | 'luggage.board';

export interface QueuedCustody<T = unknown> {
  /** `${intent}:${code}` — see the header on why this pair is enough. */
  key: string;
  intent: CustodyIntent;
  code: string;
  /** Whatever the submitting action needs beyond the code. */
  input: T;
  queuedAt: number;
  /** Set after a flush attempt failed for a reason that was not the
   *  network — surfaced to the crew rather than retried forever. */
  lastError?: string;
}

function keyFor(intent: CustodyIntent, code: string): string {
  return `${intent}:${code.toUpperCase()}`;
}

/** Queue one custody move. Overwrites any identical pending intent for
 *  the same code, which is the correct response to a double-scan. */
export async function queueCustody<T>(
  intent: CustodyIntent,
  code: string,
  input: T,
): Promise<void> {
  if (!offlineSupported()) throw new Error('This device cannot hold work offline.');
  const clean = code.trim().toUpperCase();
  if (!clean) throw new Error('No code to queue.');
  const entry: QueuedCustody<T> = {
    key: keyFor(intent, clean),
    intent,
    code: clean,
    input,
    queuedAt: Date.now(),
  };
  await tx(STORE_CUSTODY, 'readwrite', (s) => s.put(entry));
}

export async function listQueuedCustody<T = unknown>(): Promise<QueuedCustody<T>[]> {
  if (!offlineSupported()) return [];
  try {
    const all = await tx<QueuedCustody<T>[]>(
      STORE_CUSTODY, 'readonly', (s) => s.getAll() as IDBRequest<QueuedCustody<T>[]>,
    );
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

/** How many moves are waiting — for the badge a crew member glances at
 *  to know whether the day's work has actually left the device. */
export async function pendingCustodyCount(): Promise<number> {
  return (await listQueuedCustody()).length;
}

async function remove(key: string): Promise<void> {
  await tx(STORE_CUSTODY, 'readwrite', (s) => s.delete(key) as unknown as IDBRequest<undefined>);
}

async function markFailed<T>(entry: QueuedCustody<T>, error: string): Promise<void> {
  await tx(STORE_CUSTODY, 'readwrite', (s) => s.put({ ...entry, lastError: error }));
}

export interface CustodyFlushResult {
  /** Keys that reached the server (or were already there). */
  synced: string[];
  /** Still queued, with why. A network failure leaves no message — it
   *  will simply be retried. */
  stuck: { key: string; code: string; error: string }[];
}

/**
 * Error codes that mean "this already happened" rather than "this
 * failed". Dropping the queued item on one of these is correct: the
 * world is already in the state the crew member intended, and retrying
 * forever would leave them staring at a failure for a box that shipped
 * hours ago.
 *
 * Matched on codes, never on prose — the lesson from the booking
 * queue's regex, which was one copy-edit away from stranding parcels
 * and matched one of its two server paths only by substring luck.
 */
const ALREADY_DONE = new Set([
  'LABEL_ALREADY_SPENT',
  'ALREADY_CLAIMED',
  'ALREADY_DELIVERED',
  'ALREADY_SETTLED',
]);

// Note what is *not* in that set, because it is the happy path rather
// than an omission: dbx.ScanHandoff already returns success for a
// replayed scan by whoever is holding the parcel ("already holding it
// — replayed scan"), and BoardLuggage returns the tag unchanged when it
// is already ABOARD. The commonest replay therefore arrives here as
// ok:true and never reaches this set at all. The codes above are the
// narrower case where the world moved *past* the intent while the
// device was dark.

/**
 * Send everything queued, oldest first.
 *
 * `submit` is injected rather than imported so this module stays free
 * of any one portal's server-action wiring — the same shape the booking
 * queue uses, for the same reason: two counters and a crew desk each
 * pass their own session-scoped actions.
 */
export async function flushCustody<T = unknown>(
  submit: (entry: QueuedCustody<T>) =>
    Promise<{ ok: true } | { ok: false; error: string; errorCode?: string }>,
): Promise<CustodyFlushResult> {
  const result: CustodyFlushResult = { synced: [], stuck: [] };
  if (!offlineSupported()) return result;

  for (const entry of await listQueuedCustody<T>()) {
    let res: Awaited<ReturnType<typeof submit>>;
    try {
      res = await submit(entry);
    } catch {
      // Still offline. Leave it queued, say nothing, try again later.
      result.stuck.push({ key: entry.key, code: entry.code, error: '' });
      continue;
    }
    if (res.ok || (res.errorCode && ALREADY_DONE.has(res.errorCode))) {
      await remove(entry.key);
      result.synced.push(entry.key);
      continue;
    }
    // A real rejection — a parcel that was cancelled, a tag belonging to
    // another company, an expired session. Retrying will not fix it, so
    // surface it instead of hiding it behind a spinner forever.
    await markFailed(entry, res.error);
    result.stuck.push({ key: entry.key, code: entry.code, error: res.error });
  }
  return result;
}

/** Drop one stuck item. The escape hatch for a crew member who has
 *  resolved something by other means (phoned the office, re-scanned at
 *  the next stage) and should not carry a permanent red badge for it.
 *  Deliberately explicit — nothing clears a stuck item automatically. */
export async function discardCustody(key: string): Promise<void> {
  await remove(key);
}
