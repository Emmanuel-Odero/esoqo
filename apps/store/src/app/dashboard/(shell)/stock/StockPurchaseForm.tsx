'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { addStockPurchase } from './actions';

interface Product { id: string; name: string }
interface Supplier { id: string; name: string }

export function StockPurchaseForm({ storeId, products, suppliers }: {
  storeId: string; products: Product[]; suppliers: Supplier[];
}) {
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const totalKes = (Number(quantity) || 0) * (Number(unitCost) || 0);

  function submit() {
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await addStockPurchase(storeId, {
        productId,
        supplierId: supplierId || null,
        quantity: Number(quantity),
        unitCostKes: Number(unitCost),
        purchasedAt: purchasedAt ? new Date(purchasedAt).toISOString() : undefined,
        notes,
      });
      if (!result.ok) { setError(result.error); return; }
      setQuantity(''); setUnitCost(''); setNotes(''); setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  }

  if (products.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>Add a product first, then record what you bought for it.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="stkproduct">Product</label>
          <select className="inp" id="stkproduct" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="lab" htmlFor="stkqty">Quantity</label>
          <input className="inp mono" id="stkqty" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="50" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label className="lab" htmlFor="stkcost">Unit cost (KES)</label>
          <input className="inp mono" id="stkcost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" placeholder="60" />
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
        <div className="fld" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="stksupplier">Supplier (optional)</label>
          <select className="inp" id="stksupplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not recorded</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
          <label className="lab" htmlFor="stkdate">Date received</label>
          <input className="inp mono" id="stkdate" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
        </div>
        <div className="fld" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="stknotes">Notes (optional)</label>
          <input className="inp" id="stknotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Half crate, slightly bruised" />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        {totalKes > 0 && <span className="mono" style={{ fontSize: '.85rem', color: 'var(--tx-2)' }}>Total: KES {totalKes.toLocaleString('en-KE')}</span>}
        <button
          type="button" className="btn btn-p" style={{ marginLeft: 'auto' }} onClick={submit}
          disabled={pending || !productId || !quantity || !unitCost}
        >
          {pending ? 'Recording…' : 'Record delivery'}
        </button>
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 10 }}><Icon name="alert-circle" size={14} />{error}</p>}
      {saved && <p style={{ color: 'var(--green)', fontSize: '.85rem', marginTop: 10, fontWeight: 600 }}><Icon name="check" size={14} /> Recorded — stock and cost updated</p>}
    </div>
  );
}
