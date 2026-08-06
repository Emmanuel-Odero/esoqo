'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@esoko/ui';
import { syncPosSale } from './actions';
import { queueSale, listQueuedSales, removeQueuedSale, type QueuedSale } from '@/lib/pos-offline';

interface Product { id: string; name: string; priceKes: number }

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function PosClient({ storeId, products }: { storeId: string; products: Product[] }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'CASH' | 'MPESA_TILL'>('CASH');
  const [browserOnline, setBrowserOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const effectiveOnline = browserOnline;

  const refreshQueueCount = useCallback(async () => {
    const q = await listQueuedSales();
    setQueuedCount(q.filter((s) => s.storeId === storeId).length);
  }, [storeId]);

  const flush = useCallback(async () => {
    const queued = (await listQueuedSales()).filter((s) => s.storeId === storeId);
    for (const sale of queued) {
      try {
        await syncPosSale(storeId, sale);
        await removeQueuedSale(sale.clientSaleId);
      } catch {
        break;
      }
    }
    await refreshQueueCount();
  }, [storeId, refreshQueueCount]);

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    refreshQueueCount();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [refreshQueueCount]);

  useEffect(() => { if (effectiveOnline) flush(); }, [effectiveOnline, flush]);

  const items = Object.entries(cart)
    .map(([id, qty]) => ({ product: products.find((p) => p.id === id)!, qty }))
    .filter((i) => i.product);
  const total = items.reduce((s, i) => s + i.product.priceKes * i.qty, 0);

  function add(id: string) { setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 })); }

  async function completeSale() {
    if (items.length === 0) return;
    const sale: QueuedSale = {
      clientSaleId: crypto.randomUUID(),
      storeId,
      paymentMethod: method,
      soldAt: new Date().toISOString(),
      items: items.map((i) => ({ productId: i.product.id, quantity: i.qty, unitPriceKes: i.product.priceKes })),
    };
    if (effectiveOnline) {
      try {
        await syncPosSale(storeId, sale);
        setFlash('Sale recorded');
      } catch {
        await queueSale(sale);
        await refreshQueueCount();
        setFlash('Offline — sale queued');
      }
    } else {
      await queueSale(sale);
      await refreshQueueCount();
      setFlash('Offline — sale queued');
    }
    setCart({});
    setTimeout(() => setFlash(null), 2500);
  }

  return (
    <div>
      {!effectiveOnline && (
        <div className="pos-off">
          <Icon name="wifi-off" size={14} />No connection — sales are queuing on this device and will sync automatically
        </div>
      )}
      <div className="pos">
        <div>
          {products.length === 0 ? (
            <div className="pos-empty">
              <Icon name="box" size={28} style={{ marginBottom: 10, display: 'block', color: 'var(--tx-3)' }} />
              <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>No products yet — add them from the dashboard.</p>
            </div>
          ) : (
            <div className="pos-items">
              {products.map((p) => (
                <button type="button" key={p.id} className="pos-item" onClick={() => add(p.id)}>
                  <b>{p.name}</b>
                  <span>{kes(p.priceKes)}</span>
                  <span className="pos-add"><Icon name="plus" size={12} /> Add</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pos-cart">
          <h4 style={{ margin: '0 0 14px', fontSize: '.95rem' }}>Current sale</h4>
          {items.length === 0 && <div className="pos-empty"><Icon name="basket" size={22} style={{ marginBottom: 8, color: 'var(--tx-3)' }} /><p style={{ margin: 0 }}>Tap a product to add it.</p></div>}
          {items.map((i) => (
            <div className="pos-cline" key={i.product.id}>
              <span>{i.product.name} ×{i.qty}</span>
              <span style={{ fontWeight: 600 }}>{kes(i.product.priceKes * i.qty)}</span>
            </div>
          ))}
          {items.length > 0 && (
            <>
              <div className="pos-tot"><span>Total</span><span>{kes(total)}</span></div>
              <div className="pos-pay">
                <button type="button" aria-pressed={method === 'CASH'} onClick={() => setMethod('CASH')}>Cash</button>
                <button type="button" aria-pressed={method === 'MPESA_TILL'} onClick={() => setMethod('MPESA_TILL')}>M-Pesa till</button>
              </div>
              <button type="button" className="btn btn-g" style={{ width: '100%' }} disabled={items.length === 0} onClick={completeSale}>
                Complete sale <Icon name="check" size={14} />
              </button>
            </>
          )}
          {flash && <p className="pos-queue" style={{ color: 'var(--green)', fontWeight: 600 }}><Icon name="check" size={12} />{flash}</p>}
          {queuedCount > 0 && (
            <p className="pos-queue"><Icon name="refresh" size={12} />{queuedCount} sale{queuedCount === 1 ? '' : 's'} queued — will sync when back online</p>
          )}
        </div>
      </div>
    </div>
  );
}