'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { addProduct } from './actions';

export function ProductForm({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />Add product
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addProduct(storeId, {
        name,
        priceKes: Number(price),
        stockQty: stock === '' ? null : Number(stock),
      });
      if (!result.ok) { setError(result.error); return; }
      setName(''); setPrice(''); setStock(''); setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="pname">Product name</label>
          <input className="inp" id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tomatoes (1kg)" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="lab" htmlFor="pprice">Price (KES)</label>
          <input className="inp mono" id="pprice" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="120" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="lab" htmlFor="pstock">Stock (optional)</label>
          <input className="inp mono" id="pstock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" placeholder="Untracked" />
        </div>
        <button type="button" className="btn btn-p" onClick={submit} disabled={pending || !name.trim() || !price}>
          {pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn-o" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 10 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
