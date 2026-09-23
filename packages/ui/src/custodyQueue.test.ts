import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The custody queue's whole job is to be correct about three things:
 * what counts as "already done", what counts as still-offline, and what
 * counts as a real rejection a crew member has to see. Getting any of
 * them wrong loses a custody record or strands one forever.
 *
 * IndexedDB is stubbed with a tiny in-memory store rather than pulled in
 * as a dependency — the module's logic is what is under test here, not
 * the browser's key-value engine.
 */

interface Row { key: string; [k: string]: unknown }

const store = new Map<string, Row>();

function fakeRequest<T>(result: T) {
  const req = { result, onsuccess: null as null | (() => void), onerror: null } as unknown as IDBRequest<T>;
  queueMicrotask(() => (req as unknown as { onsuccess?: () => void }).onsuccess?.());
  return req;
}

beforeEach(() => {
  store.clear();
  vi.resetModules();
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        put: (v: Row) => { store.set(v.key, v); return fakeRequest(undefined); },
        delete: (k: string) => { store.delete(k); return fakeRequest(undefined); },
        getAll: () => fakeRequest([...store.values()]),
      }),
      set oncomplete(fn: () => void) { queueMicrotask(fn); },
    }),
    close: () => {},
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req = { result: fakeDb, onsuccess: null, onupgradeneeded: null, onerror: null } as never;
      queueMicrotask(() => (req as unknown as { onsuccess?: () => void }).onsuccess?.());
      return req;
    },
  });
});

async function load() {
  return import('./custodyQueue');
}

describe('queueCustody', () => {
  it('keys on intent and code, so a double-scan overwrites instead of duplicating', async () => {
    const { queueCustody, listQueuedCustody } = await load();
    await queueCustody('luggage.board', 'LUG-ABC123', { code: 'LUG-ABC123' });
    await queueCustody('luggage.board', 'LUG-ABC123', { code: 'LUG-ABC123' });
    // A conductor scanning the same tag twice because the first beep was
    // lost in traffic must not produce two queued moves.
    expect((await listQueuedCustody()).length).toBe(1);
  });

  it('treats the same code under different intents as different work', async () => {
    const { queueCustody, listQueuedCustody } = await load();
    await queueCustody('parcel.receive', 'PKG-XYZ', {});
    await queueCustody('parcel.handoff', 'PKG-XYZ', {});
    expect((await listQueuedCustody()).length).toBe(2);
  });

  it('normalises the code so case cannot split one bag into two rows', async () => {
    const { queueCustody, listQueuedCustody } = await load();
    await queueCustody('luggage.board', 'lug-abc123', {});
    await queueCustody('luggage.board', 'LUG-ABC123', {});
    expect((await listQueuedCustody()).length).toBe(1);
  });

  it('refuses a blank code rather than queueing something unreplayable', async () => {
    const { queueCustody } = await load();
    await expect(queueCustody('luggage.board', '   ', {})).rejects.toThrow();
  });
});

describe('flushCustody', () => {
  it('clears an item the server accepted', async () => {
    const { queueCustody, flushCustody, pendingCustodyCount } = await load();
    await queueCustody('luggage.board', 'LUG-1', {});
    const res = await flushCustody(async () => ({ ok: true as const }));
    expect(res.synced.length).toBe(1);
    expect(await pendingCustodyCount()).toBe(0);
  });

  it('clears an item whose work had already happened', async () => {
    // The world moved past the intent while the device was dark. Not a
    // failure — retrying forever would leave a crew member staring at an
    // error for a bag that went out hours ago.
    const { queueCustody, flushCustody, pendingCustodyCount } = await load();
    await queueCustody('luggage.board', 'LUG-2', {});
    const res = await flushCustody(async () => ({
      ok: false as const, error: 'already', errorCode: 'ALREADY_CLAIMED',
    }));
    expect(res.synced.length).toBe(1);
    expect(await pendingCustodyCount()).toBe(0);
  });

  it('keeps an item when the submit threw — that is still-offline, not a rejection', async () => {
    const { queueCustody, flushCustody, pendingCustodyCount } = await load();
    await queueCustody('luggage.board', 'LUG-3', {});
    const res = await flushCustody(async () => { throw new Error('offline'); });
    expect(await pendingCustodyCount()).toBe(1);
    // Reported with an empty message, which is how the UI knows not to
    // show it as something needing attention.
    expect(res.stuck[0]?.error).toBe('');
  });

  it('keeps and surfaces a genuine rejection', async () => {
    const { queueCustody, flushCustody, pendingCustodyCount } = await load();
    await queueCustody('parcel.receive', 'PKG-4', {});
    const res = await flushCustody(async () => ({
      ok: false as const, error: 'That parcel was cancelled', errorCode: 'BAD_INPUT',
    }));
    expect(await pendingCustodyCount()).toBe(1);
    expect(res.stuck[0]?.error).toBe('That parcel was cancelled');
  });

  it('never decides on the message text', async () => {
    // The booking queue's original sin, not repeated: prose that looks
    // like a success must not clear an item when the code says otherwise.
    const { queueCustody, flushCustody, pendingCustodyCount } = await load();
    await queueCustody('luggage.board', 'LUG-5', {});
    await flushCustody(async () => ({
      ok: false as const,
      error: 'already claimed, already delivered, already settled',
      errorCode: 'FORBIDDEN',
    }));
    expect(await pendingCustodyCount()).toBe(1);
  });

  it('flushes oldest first, so custody replays in the order it happened', async () => {
    const { queueCustody, flushCustody } = await load();
    await queueCustody('luggage.board', 'LUG-FIRST', {});
    await new Promise((r) => setTimeout(r, 2));
    await queueCustody('luggage.board', 'LUG-SECOND', {});
    const seen: string[] = [];
    await flushCustody(async (e) => { seen.push(e.code); return { ok: true as const }; });
    expect(seen).toEqual(['LUG-FIRST', 'LUG-SECOND']);
  });
});

describe('discardCustody', () => {
  it('drops a stuck item the crew resolved another way', async () => {
    const { queueCustody, discardCustody, listQueuedCustody, pendingCustodyCount } = await load();
    await queueCustody('luggage.board', 'LUG-6', {});
    const [entry] = await listQueuedCustody();
    await discardCustody(entry!.key);
    expect(await pendingCustodyCount()).toBe(0);
  });
});
