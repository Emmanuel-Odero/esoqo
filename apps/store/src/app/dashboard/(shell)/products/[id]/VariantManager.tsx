'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { addVariant, removeVariant } from './actions';

interface Variant { id: string; label: string; priceKes: number; costKes: number | null; stockQty: number | null; sku: string | null }

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function VariantManager({ productId, variants }: { productId: string; variants: Variant[] }) {
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addVariant(productId, { label, priceKes: Number(price), stockQty: stock === '' ? null : Number(stock) });
      if (!result.ok) { setError(result.error); return; }
      setLabel(''); setPrice(''); setStock(''); router.refresh();
    });
  }

  function remove(variantId: string) {
    startTransition(async () => {
      const result = await removeVariant(variantId, productId);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 4px', fontSize: '.9rem' }}>Options</h4>
      <p className="hint" style={{ margin: '0 0 12px' }}>Sizes, colours, weights — each with its own price and stock. Leave empty to sell the product as one thing.</p>

      {variants.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {variants.map((v) => (
            <div key={v.id} className="review-line">
              <span>{v.label}{v.sku ? ` (${v.sku})` : ''} — {v.stockQty === null ? 'untracked' : `${v.stockQty} in stock`}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <b className="mono">{kes(v.priceKes)}</b>
                <button type="button" aria-label={`Remove ${v.label}`} onClick={() => remove(v.id)} disabled={pending}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 120, marginBottom: 0 }}>
          <label className="lab" htmlFor="vlabel">Label</label>
          <input className="inp" id="vlabel" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="500g" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 90, marginBottom: 0 }}>
          <label className="lab" htmlFor="vprice">Price (KES)</label>
          <input className="inp mono" id="vprice" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 90, marginBottom: 0 }}>
          <label className="lab" htmlFor="vstock">Stock</label>
          <input className="inp mono" id="vstock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" placeholder="Untracked" />
        </div>
        <button type="button" className="btn btn-p btn-sm" onClick={submit} disabled={pending || !label.trim() || !price}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 8 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
