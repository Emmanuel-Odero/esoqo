'use client';

/**
 * The PoS terminal's offline outbox. Sales made with no connection are
 * queued here (IndexedDB — survives a tab close, unlike an in-memory
 * queue) and flushed once the connection returns. clientSaleId is the
 * idempotency key the DAL's recordPosSale checks, so a sale synced
 * twice from a flaky connection is never double-counted.
 */

const DB_NAME = 'esoko-pos-outbox';
const STORE = 'queued-sales';

export interface QueuedSale {
  clientSaleId: string;
  storeId: string;
  paymentMethod: 'CASH' | 'MPESA_TILL' | 'ON_ACCOUNT';
  soldAt: string;
  items: { productId: string; variantId?: string | null; quantity: number; unitPriceKes: number; discountKes?: number }[];
  discountKes?: number;
  tenderedKes?: number;
  cashierId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  customerMsisdn?: string;
  customerName?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'clientSaleId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSale(sale: QueuedSale): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedSales(): Promise<QueuedSale[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedSale[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedSale(clientSaleId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clientSaleId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
