'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import { submitReceiptItems } from './actions';

interface Product { id: string; name: string; priceKes: number; stockQty: number | null }
interface CartLine { qty: number; unitPriceKes: number }

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

/**
 * The same tap-a-product, edit-the-price, remove-a-line picker as the
 * PoS terminal (see PosClient.tsx) — a cashier who already rings up a
 * sale sees the same screen here, not a new tool. The one new idea:
 * this money already arrived, so instead of change due there's a
 * remaining balance that has to land on exactly zero before Done
 * unlocks — same subtraction, same place on screen, just counting down
 * from what was paid instead of up from what's tendered.
 */
export function ItemizeClient({ receiptId, receiptCode, totalKes, buyerName, buyerMsisdn, products }: {
  receiptId: string; receiptCode: string; totalKes: number;
  buyerName: string | null; buyerMsisdn: string | null; products: Product[];
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = Object.entries(cart)
    .map(([id, line]) => ({ product: products.find((p) => p.id === id)!, ...line }))
    .filter((i) => i.product);
  const addedKes = items.reduce((s, i) => s + i.unitPriceKes * i.qty, 0);
  const remainingKes = Math.round((totalKes - addedKes) * 100) / 100;
  const settled = remainingKes === 0 && items.length > 0;

  function add(id: string) {
    setCart((c) => {
      const existing = c[id];
      if (existing) return { ...c, [id]: { ...existing, qty: existing.qty + 1 } };
      const product = products.find((p) => p.id === id)!;
      return { ...c, [id]: { qty: 1, unitPriceKes: product.priceKes } };
    });
  }

  function setLinePrice(id: string, unitPriceKes: number) {
    // The input's min={0} is a browser hint only — Chrome, at least,
    // still lets a user type a leading "-" and hand this a negative
    // number. addReceiptItems rejects it server-side regardless, but
    // there's no reason to let the UI show a receipt line it already
    // knows is invalid on the way there.
    setCart((c) => (c[id] && Number.isFinite(unitPriceKes) && unitPriceKes >= 0 ? { ...c, [id]: { ...c[id]!, unitPriceKes } } : c));
  }

  function setLineQty(id: string, qty: number) {
    setCart((c) => (c[id] && Number.isInteger(qty) && qty > 0 ? { ...c, [id]: { ...c[id]!, qty } } : c));
  }

  function removeLine(id: string) {
    setCart((c) => { const next = { ...c }; delete next[id]; return next; });
  }

  async function submit() {
    if (!settled) return;
    setBusy(true); setError(null);
    const result = await submitReceiptItems(
      receiptId,
      items.map((i) => ({ productId: i.product.id, quantity: i.qty, unitPriceKes: i.unitPriceKes })),
    );
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.push('/dashboard/receipts');
  }

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Add items to a receipt</h1>
          <p className="sub mono">{receiptCode}{buyerName ? ` · ${buyerName}` : ''}{buyerMsisdn ? ` · ${buyerMsisdn}` : ''}</p>
        </div>
      </div>
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
          <h4 style={{ margin: '0 0 14px', fontSize: '.95rem' }}>KES {totalKes.toLocaleString('en-KE')} already paid — add what it was for</h4>
          {items.length === 0 && <div className="pos-empty"><Icon name="basket" size={22} style={{ marginBottom: 8, color: 'var(--tx-3)' }} /><p style={{ margin: 0 }}>Tap a product to add it.</p></div>}
          {items.map((i) => (
            <div className="pos-cline" key={i.product.id}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i.product.name}
                <input
                  className="inp mono" type="number" min={1} step="1"
                  value={i.qty}
                  onChange={(e) => setLineQty(i.product.id, Number(e.target.value))}
                  style={{ width: 46, padding: '4px 6px', fontSize: '.8rem' }}
                  aria-label={`Quantity of ${i.product.name}`}
                />
              </span>
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
            <div className="pos-cline" style={{ color: settled ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
              <span>{remainingKes > 0 ? 'Remaining' : remainingKes < 0 ? 'Over by' : 'Balanced'}</span>
              <span>{kes(Math.abs(remainingKes))}</span>
            </div>
          )}
          <button type="button" className="btn btn-g" style={{ width: '100%', marginTop: 8 }} disabled={!settled || busy} onClick={submit}>
            {busy ? 'Saving…' : 'Done'} <Icon name="check" size={14} />
          </button>
          {error && <p className="err" role="alert" style={{ marginTop: 8 }}><Icon name="alert-circle" size={14} />{error}</p>}
        </div>
      </div>
    </>
  );
}
