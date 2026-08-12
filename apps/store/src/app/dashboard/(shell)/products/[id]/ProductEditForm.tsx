'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { PRODUCT_CATEGORIES } from '@esoko/domain';
import { saveProduct, removeProduct } from './actions';
import { UnitPicker } from '../UnitPicker';

interface Product {
  id: string; name: string; description: string | null; category: string | null;
  priceKes: number; costKes: number | null; unit: string | null; purchaseUnit: string | null; stockQty: number | null;
  availableOnOrder: boolean;
}

export function ProductEditForm({ product }: { product: Product }) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [category, setCategory] = useState(product.category ?? '');
  const [price, setPrice] = useState(String(product.priceKes));
  const [cost, setCost] = useState(product.costKes !== null ? String(product.costKes) : '');
  const [unit, setUnit] = useState(product.unit ?? '');
  const [purchaseUnit, setPurchaseUnit] = useState(product.purchaseUnit ?? '');
  const [stock, setStock] = useState(product.stockQty !== null ? String(product.stockQty) : '');
  const [orderFirst, setOrderFirst] = useState(product.availableOnOrder);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await saveProduct(product.id, {
        name, description, category: category || undefined,
        priceKes: Number(price), costKes: cost === '' ? null : Number(cost),
        unit, purchaseUnit: purchaseUnit || null, stockQty: stock === '' ? null : Number(stock),
        availableOnOrder: orderFirst,
      });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true); router.refresh();
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeProduct(product.id);
      if (!result.ok) { setError(result.error); setConfirmDelete(false); return; }
      router.push('/dashboard/products');
    });
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
          <label className="lab" htmlFor="ename">Name</label>
          <input className="inp" id="ename" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tomatoes, Sukuma wiki, Haircut" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="ecat">Category</label>
          <select className="inp" id="ecat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Uncategorised</option>
            {PRODUCT_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <p className="hint">Groups this with similar items so shoppers can filter your storefront by type.</p>
        </div>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="edesc">Description (optional)</label>
        <input
          className="inp" id="edesc" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Freshly harvested, sold whole. Ripens in 2–3 days."
        />
        <p className="hint">A line or two shoppers see before they buy — what it is, its condition, anything worth knowing.</p>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label className="lab" htmlFor="eprice">Price (KES){unit && <span style={{ color: 'var(--tx-3)', fontWeight: 400 }}> per {unit}</span>}</label>
          <input className="inp mono" id="eprice" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 120" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
          <label className="lab" htmlFor="ecost">Cost (KES{purchaseUnit || unit ? ` per ${purchaseUnit || unit}` : ''}, optional)</label>
          <input className="inp mono" id="ecost" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="What you paid for it" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 190, marginBottom: 0 }}>
          <label className="lab" htmlFor="eunit">Sold by</label>
          <UnitPicker id="eunit" value={unit} onChange={setUnit} />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 190, marginBottom: 0 }}>
          <label className="lab" htmlFor="eboughtin">Bought in</label>
          <UnitPicker id="eboughtin" value={purchaseUnit} onChange={setPurchaseUnit} emptyLabel="Same as how you sell it" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
          <label className="lab" htmlFor="estock">How many do you have?{purchaseUnit && <span style={{ color: 'var(--tx-3)', fontWeight: 400 }}> ({purchaseUnit})</span>}</label>
          <input className="inp mono" id="estock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" placeholder="Leave blank if you don't count" />
        </div>
      </div>
      <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Cost price is what lets your <a href="/dashboard/reports">Reports</a> page show real profit, not just sales. It's never shown to shoppers.
      </p>

      <button
        type="button"
        className="opt"
        aria-pressed={orderFirst}
        onClick={() => setOrderFirst(!orderFirst)}
        style={{ width: '100%', marginBottom: 8 }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 12 }}>
          <span>
            <b className="t" style={{ fontSize: '.92rem' }}>Made to order</b>
            <span className="d">No stock kept — shoppers order now, you prepare it afterwards. Good when stock ties up money.</span>
          </span>
          <span className="mono" style={{ fontWeight: 700, flex: 'none' }}>{orderFirst ? 'On' : 'Off'}</span>
        </span>
      </button>

      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
      {saved && <p style={{ color: 'var(--green)', fontSize: '.85rem', fontWeight: 600 }}><Icon name="check" size={14} /> Saved</p>}

      <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-g" onClick={submit} disabled={pending || !name.trim() || !price}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        {!confirmDelete ? (
          <button type="button" className="btn btn-o btn-sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="ban" size={13} />Delete product
          </button>
        ) : (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '.82rem', color: 'var(--tx-2)' }}>Delete permanently?</span>
            <button type="button" className="btn btn-d btn-sm" onClick={remove} disabled={pending}>Yes, delete</button>
            <button type="button" className="btn btn-o btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        )}
      </div>
    </div>
  );
}
