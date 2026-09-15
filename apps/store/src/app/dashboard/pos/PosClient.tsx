'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { syncPosSale } from './actions';
import { issueSaleReceipt } from './receipt-actions';
import { CashierBar, type CashierSession } from './CashierBar';
import { queueSale, listQueuedSales, removeQueuedSale, type QueuedSale } from '@/lib/pos-offline';

interface Product { id: string; name: string; priceKes: number; stockQty: number | null }
interface CartLine { qty: number; unitPriceKes: number }
interface Cashier { id: string; name: string; role: string }

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function PosClient({ storeId, storeSlug, products, cashiers = [], signedInCashier = null }: {
  storeId: string; storeSlug: string; products: Product[]; cashiers?: Cashier[];
  signedInCashier?: { id: string; name: string; shiftId: string | null } | null;
}) {
  const [cashierSession, setCashierSession] = useState<CashierSession | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [method, setMethod] = useState<'CASH' | 'MPESA_TILL' | 'ON_ACCOUNT'>('CASH');
  const [discount, setDiscount] = useState('');
  const [tendered, setTendered] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [showCustomerFields, setShowCustomerFields] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [lowStockFlash, setLowStockFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<{ saleId: string; customerMsisdn?: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<'PRINT' | 'SMS' | null>(null);

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
    .map(([id, line]) => ({ product: products.find((p) => p.id === id)!, ...line }))
    .filter((i) => i.product);
  const grossKes = items.reduce((s, i) => s + i.unitPriceKes * i.qty, 0);
  const discountKes = Math.min(grossKes, Number(discount) || 0);
  const total = Math.max(0, grossKes - discountKes);
  const tenderedKes = tendered === '' ? null : Number(tendered);
  const changeKes = method === 'CASH' && tenderedKes != null ? Math.round((tenderedKes - total) * 100) / 100 : null;
  const shortTender = changeKes != null && changeKes < 0;

  function add(id: string) {
    setCart((c) => {
      const existing = c[id];
      if (existing) return { ...c, [id]: { ...existing, qty: existing.qty + 1 } };
      const product = products.find((p) => p.id === id)!;
      return { ...c, [id]: { qty: 1, unitPriceKes: product.priceKes } };
    });
  }

  function setLinePrice(id: string, unitPriceKes: number) {
    setCart((c) => (c[id] ? { ...c, [id]: { ...c[id]!, unitPriceKes } } : c));
  }

  function removeLine(id: string) {
    setCart((c) => { const next = { ...c }; delete next[id]; return next; });
  }

  async function completeSale() {
    if (items.length === 0) return;
    if (shortTender) { setError('Amount tendered is less than the total'); return; }
    if (method === 'ON_ACCOUNT' && !customerPhone.trim()) { setError('An on-account sale needs the customer’s phone number'); return; }
    setError(null);
    const sale: QueuedSale = {
      clientSaleId: crypto.randomUUID(),
      storeId,
      paymentMethod: method,
      soldAt: new Date().toISOString(),
      items: items.map((i) => ({ productId: i.product.id, quantity: i.qty, unitPriceKes: i.unitPriceKes })),
      discountKes: discountKes || undefined,
      tenderedKes: method === 'CASH' && tenderedKes != null ? tenderedKes : undefined,
      customerMsisdn: customerPhone.trim() || undefined,
      customerName: customerName.trim() || undefined,
      cashierId: cashierSession?.cashierId ?? undefined,
      shiftId: cashierSession?.shiftId ?? undefined,
    };
    if (effectiveOnline) {
      try {
        const result = await syncPosSale(storeId, sale);
        setFlash('Sale recorded');
        setLastSale({ saleId: result.sale.id, customerMsisdn: sale.customerMsisdn });
        if (result.lowStock.length > 0) {
          setLowStockFlash(`Running low: ${result.lowStock.map((l) => `${l.name} (${l.remainingQty} left)`).join(', ')}`);
        }
      } catch (e) {
        if (e instanceof Error && /tendered|on-account|phone/i.test(e.message)) { setError(e.message); return; }
        await queueSale(sale);
        await refreshQueueCount();
        setFlash('Offline — sale queued');
      }
    } else {
      if (method === 'ON_ACCOUNT') { setError('On-account sales need a connection to charge the right customer'); return; }
      await queueSale(sale);
      await refreshQueueCount();
      setFlash('Offline — sale queued');
    }
    setCart({}); setDiscount(''); setTendered(''); setCustomerPhone(''); setCustomerName(''); setShowCustomerFields(false); setMethod('CASH');
    setTimeout(() => { setFlash(null); setLowStockFlash(null); }, 4000);
  }

  async function printReceipt() {
    if (!lastSale) return;
    setReceiptBusy('PRINT'); setError(null);
    const result = await issueSaleReceipt(storeId, { saleId: lastSale.saleId, channel: 'PRINT' });
    setReceiptBusy(null);
    if (!result.ok) { setError(result.error); return; }
    window.open(`/dashboard/receipts/${result.receiptId}`, '_blank');
  }

  async function smsReceipt() {
    if (!lastSale?.customerMsisdn) return;
    setReceiptBusy('SMS'); setError(null);
    const result = await issueSaleReceipt(storeId, { saleId: lastSale.saleId, channel: 'SMS', sentTo: lastSale.customerMsisdn });
    setReceiptBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setFlash('Receipt sent by SMS');
    setTimeout(() => setFlash(null), 3000);
  }

  return (
    <div>
      {!effectiveOnline && (
        <div className="pos-off">
          <Icon name="wifi-off" size={14} />No connection — sales are queuing on this device and will sync automatically
        </div>
      )}
      <CashierBar storeId={storeId} storeSlug={storeSlug} cashiers={cashiers} signedInCashier={signedInCashier} onSession={setCashierSession} />
      <div className="pos">
        <div>
          {products.length === 0 ? (
            <div className="pos-empty">
              <Icon name="box" size={28} style={{ marginBottom: 10, display: 'block', color: 'var(--tx-3)' }} />
              <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>No products yet — add them from the dashboard.</p>
            </div>
          ) : (
            <div className="pos-items">
              {products.map((p) => {
                const low = p.stockQty !== null && p.stockQty <= 5;
                const out = p.stockQty !== null && p.stockQty <= 0;
                return (
                  <button type="button" key={p.id} className="pos-item" onClick={() => add(p.id)}>
                    <b>{p.name}</b>
                    <span>{kes(p.priceKes)}</span>
                    {p.stockQty !== null && (
                      <span style={{ color: out ? 'var(--red)' : low ? 'var(--amber, #b8760b)' : 'var(--tx-3)', fontSize: '.72rem' }}>
                        {out ? 'Out of stock' : `${p.stockQty} left`}
                      </span>
                    )}
                    <span className="pos-add"><Icon name="plus" size={12} /> Add</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="pos-cart">
          <h4 style={{ margin: '0 0 14px', fontSize: '.95rem' }}>Current sale</h4>
          {items.length === 0 && <div className="pos-empty"><Icon name="basket" size={22} style={{ marginBottom: 8, color: 'var(--tx-3)' }} /><p style={{ margin: 0 }}>Tap a product to add it.</p></div>}
          {items.map((i) => (
            <div className="pos-cline" key={i.product.id}>
              <span>{i.product.name} ×{i.qty}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="inp mono" type="number" min={0} step="0.01"
                  value={i.unitPriceKes}
                  onChange={(e) => setLinePrice(i.product.id, Number(e.target.value))}
                  style={{ width: 76, padding: '4px 6px', fontSize: '.8rem' }}
                  aria-label={`Price for ${i.product.name}`}
                />
                <button type="button" onClick={() => removeLine(i.product.id)} aria-label={`Remove ${i.product.name}`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            </div>
          ))}
          {items.length > 0 && (
            <>
              <div className="pos-cline">
                <span>Discount</span>
                <input
                  className="inp mono" type="number" min={0} max={grossKes} step="0.01"
                  value={discount} onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0" style={{ width: 90, padding: '4px 6px', fontSize: '.8rem' }}
                  aria-label="Whole-sale discount"
                />
              </div>
              <div className="pos-tot"><span>Total</span><span>{kes(total)}</span></div>
              <div className="pos-pay">
                <button type="button" aria-pressed={method === 'CASH'} onClick={() => setMethod('CASH')}>Cash</button>
                <button type="button" aria-pressed={method === 'MPESA_TILL'} onClick={() => setMethod('MPESA_TILL')}>M-Pesa till</button>
                <button type="button" aria-pressed={method === 'ON_ACCOUNT'} onClick={() => setMethod('ON_ACCOUNT')}>On account</button>
              </div>
              {(method === 'ON_ACCOUNT' || showCustomerFields) && (
                <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                  <input
                    className="inp mono" type="tel"
                    value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+2547XXXXXXXX" style={{ padding: '6px 8px', fontSize: '.82rem' }}
                    aria-label="Customer phone"
                  />
                  <input
                    className="inp" type="text"
                    value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Name (optional)" style={{ padding: '6px 8px', fontSize: '.82rem' }}
                    aria-label="Customer name"
                  />
                </div>
              )}
              {method !== 'ON_ACCOUNT' && !showCustomerFields && (
                <button type="button" className="btn btn-o btn-sm" style={{ marginBottom: 8 }} onClick={() => setShowCustomerFields(true)}>
                  <Icon name="user" size={12} />Tag a customer
                </button>
              )}
              {method === 'CASH' && (
                <div className="pos-cline">
                  <span>Cash tendered</span>
                  <input
                    className="inp mono" type="number" min={0} step="0.01"
                    value={tendered} onChange={(e) => setTendered(e.target.value)}
                    placeholder={String(total)} style={{ width: 90, padding: '4px 6px', fontSize: '.8rem' }}
                    aria-label="Cash tendered"
                  />
                </div>
              )}
              {changeKes != null && (
                <div className="pos-cline" style={{ color: shortTender ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                  <span>{shortTender ? 'Short by' : 'Change'}</span>
                  <span>{kes(Math.abs(changeKes))}</span>
                </div>
              )}
              <button type="button" className="btn btn-g" style={{ width: '100%' }} disabled={items.length === 0 || shortTender} onClick={completeSale}>
                Complete sale <Icon name="check" size={14} />
              </button>
            </>
          )}
          {error && <p className="err" role="alert" style={{ marginTop: 8 }}><Icon name="alert-circle" size={14} />{error}</p>}
          {flash && <p className="pos-queue" style={{ color: 'var(--green)', fontWeight: 600 }}><Icon name="check" size={12} />{flash}</p>}
          {lastSale && (
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-o btn-sm" onClick={printReceipt} disabled={receiptBusy !== null}>
                <Icon name="print" size={12} />{receiptBusy === 'PRINT' ? 'Opening…' : 'Print receipt'}
              </button>
              {lastSale.customerMsisdn && (
                <button type="button" className="btn btn-o btn-sm" onClick={smsReceipt} disabled={receiptBusy !== null}>
                  <Icon name="message" size={12} />{receiptBusy === 'SMS' ? 'Sending…' : 'SMS receipt'}
                </button>
              )}
            </div>
          )}
          {lowStockFlash && <p className="pos-queue" style={{ color: 'var(--amber, #b8760b)', fontWeight: 600 }}><Icon name="alert-triangle" size={12} />{lowStockFlash}</p>}
          {queuedCount > 0 && (
            <p className="pos-queue"><Icon name="refresh" size={12} />{queuedCount} sale{queuedCount === 1 ? '' : 's'} queued — will sync when back online</p>
          )}
        </div>
      </div>
    </div>
  );
}
