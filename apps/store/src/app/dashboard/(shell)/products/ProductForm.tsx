'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS, SUB_UNITS } from '@esoqo/domain';
import { addProduct } from './actions';
import { UnitPicker } from './UnitPicker';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE', { maximumFractionDigits: 2 });

const buyLabel = (u: string) => PRODUCT_UNITS.find(([k]) => k === u)?.[1] ?? u;

interface Subdivision {
  key: string;
  label: string;
  portionSize: string;
  price: string;
}

export function ProductForm({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [stock, setStock] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [price, setPrice] = useState('');
  const [subdividing, setSubdividing] = useState(false);
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [subLabel, setSubLabel] = useState('');
  const [subSize, setSubSize] = useState('');
  const [subPrice, setSubPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const qty = Number(stock) || 0;
  const paid = Number(totalPaid) || 0;
  const costPerUnit = qty > 0 && paid > 0 ? paid / qty : null;
  const sellPrice = Number(price) || 0;
  // Cost is always per the purchase unit; profit per *sale* unit only
  // means something when the two units agree (or the merchant didn't
  // say they bought in a different one).
  const boughtIn = purchaseUnit.trim() || unit;
  const sameUnit = !purchaseUnit.trim() || purchaseUnit === unit;
  const profitPerUnit = !sameUnit ? null : costPerUnit !== null && sellPrice > 0 ? sellPrice - costPerUnit : null;
  const marginPct = profitPerUnit !== null && sellPrice > 0 ? Math.round((profitPerUnit / sellPrice) * 100) : null;

  const subUnitInfo = SUB_UNITS[unit];
  const subUnitLabel = subUnitInfo?.unit ?? unit;
  const factor = subUnitInfo?.factor ?? 1;

  function subEstimate(portionSize: string, subPriceVal: string) {
    // Cost proration only makes sense when the portion is cut from the
    // same unit the batch was bought in — a 400ml sachet from a litre of
    // oil, not a piece from a kilo of tomatoes.
    if (!sameUnit) return null;
    const size = Number(portionSize) || 0;
    const sPrice = Number(subPriceVal) || 0;
    if (size <= 0 || costPerUnit === null) return null;
    const portionInBaseUnit = size / factor;
    const cost = costPerUnit * portionInBaseUnit;
    const profit = sPrice > 0 ? sPrice - cost : null;
    return { cost, profit, portionInBaseUnit };
  }

  const liveEstimate = subEstimate(subSize, subPrice);

  function addSubdivision() {
    if (!subSize || !subPrice) return;
    const label = subLabel.trim() || `${subSize}${subUnitLabel}`;
    setSubdivisions((s) => [...s, { key: crypto.randomUUID(), label, portionSize: subSize, price: subPrice }]);
    setSubLabel(''); setSubSize(''); setSubPrice('');
  }

  function removeSubdivision(key: string) {
    setSubdivisions((s) => s.filter((d) => d.key !== key));
  }

  function reset() {
    setName(''); setCategory(''); setUnit(''); setPurchaseUnit(''); setStock(''); setTotalPaid(''); setPrice('');
    setSubdividing(false); setSubdivisions([]); setSubLabel(''); setSubSize(''); setSubPrice('');
    setOpen(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const variants = subdivisions.map((d) => {
        const est = subEstimate(d.portionSize, d.price);
        const suggestedStock = qty > 0 && est ? Math.floor(qty / est.portionInBaseUnit) : null;
        return {
          label: d.label,
          priceKes: Number(d.price),
          costKes: est ? Math.round(est.cost * 100) / 100 : null,
          stockQty: suggestedStock,
        };
      });
      const result = await addProduct(storeId, {
        name, unit, purchaseUnit: purchaseUnit || undefined, category: category || undefined,
        priceKes: Number(price),
        costKes: costPerUnit !== null ? Math.round(costPerUnit * 100) / 100 : null,
        stockQty: stock === '' ? null : Number(stock),
        variants: variants.length > 0 ? variants : undefined,
      });
      if (!result.ok) { setError(result.error); return; }
      reset();
      router.push(`/dashboard/products/${result.productId}`);
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />Add product
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <p style={{ margin: '0 0 14px', fontSize: '.85rem', color: 'var(--tx-2)' }}>
        Start with the basics, then tell us what you paid and what you'll charge — we'll work out your profit as you go.
      </p>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 180, marginBottom: 0 }}>
          <label className="lab" htmlFor="pname">What are you selling?</label>
          <input className="inp" id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cooking oil, Bar soap, Haircut" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="pcat">Category</label>
          <select className="inp" id="pcat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Uncategorised</option>
            {PRODUCT_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 190, marginBottom: 0 }}>
          <label className="lab" htmlFor="punit">Sold by</label>
          <UnitPicker id="punit" value={unit} onChange={setUnit} />
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
        <div className="fld" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
          <label className="lab" htmlFor="pstock">How many did you buy?</label>
          <input className="inp mono" id="pstock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" placeholder="e.g. 20" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 190, marginBottom: 0 }}>
          <label className="lab" htmlFor="pboughtin">Bought in</label>
          <UnitPicker id="pboughtin" value={purchaseUnit} onChange={setPurchaseUnit} emptyLabel="Same as how you sell it" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
          <label className="lab" htmlFor="ppaid">Total you paid (KES)</label>
          <input className="inp mono" id="ppaid" value={totalPaid} onChange={(e) => setTotalPaid(e.target.value)} inputMode="decimal" placeholder="e.g. 1800" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
          <label className="lab" htmlFor="pprice">Your selling price (KES){unit && <span style={{ color: 'var(--tx-3)', fontWeight: 400 }}> per {unit}</span>}</label>
          <input className="inp mono" id="pprice" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 120" />
        </div>
      </div>

      {costPerUnit !== null && (
        <p className="hint" style={{ color: 'var(--tx-2)' }}>
          That's about <b className="mono">{kes(costPerUnit)}</b> per {buyLabel(boughtIn || 'unit')}.
          {sameUnit ? (
            profitPerUnit !== null && (
              <> {profitPerUnit >= 0
                ? <>You'll make about <b className="mono" style={{ color: 'var(--green)' }}>{kes(profitPerUnit)}</b> profit per {unit || 'unit'} ({marginPct}% margin).</>
                : <span style={{ color: 'var(--red)' }}> That's a <b className="mono">{kes(Math.abs(profitPerUnit))}</b> loss per {unit || 'unit'} at this price — you might want to charge more.</span>}
              </>
            )
          ) : unit && (
            <> You sell per {unit} — profit per sale depends on how many {unit} you get from one {buyLabel(boughtIn)}. Pick a sell unit that's convertible, or price pieces using an option on this product.</>
          )}
        </p>
      )}

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        {!subdividing ? (
          <button type="button" className="btn btn-o btn-sm" onClick={() => setSubdividing(true)}>
            <Icon name="plus" size={13} />Sell this in smaller portions too
          </button>
        ) : (
          <>
            <p style={{ fontWeight: 700, fontSize: '.87rem', margin: '0 0 4px' }}>Smaller portions</p>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              Split what you bought into {subUnitInfo ? `${subUnitLabel} portions` : 'smaller portions'} and sell each on its own — like a 400ml sachet cut from a bigger container.
              {costPerUnit === null && ' Fill in what you bought and paid above to see profit per portion.'}
            </p>

            {subdivisions.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {subdivisions.map((d) => {
                  const est = subEstimate(d.portionSize, d.price);
                  return (
                    <div key={d.key} className="review-line">
                      <span>{d.label} — {kes(Number(d.price))}
                        {est?.profit != null && (
                          <span style={{ color: est.profit >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: 6 }}>
                            ({est.profit >= 0 ? '+' : ''}{kes(est.profit)} profit)
                          </span>
                        )}
                      </span>
                      <button type="button" onClick={() => removeSubdivision(d.key)} aria-label={`Remove ${d.label}`}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="fld" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
                <label className="lab" htmlFor="subsize">Portion size{subUnitInfo && <span style={{ color: 'var(--tx-3)', fontWeight: 400 }}> ({subUnitLabel})</span>}</label>
                <input className="inp mono" id="subsize" value={subSize} onChange={(e) => setSubSize(e.target.value)} inputMode="decimal" placeholder={subUnitInfo ? 'e.g. 400' : 'e.g. 0.5'} />
              </div>
              <div className="fld" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
                <label className="lab" htmlFor="sublabel">Label (optional)</label>
                <input className="inp" id="sublabel" value={subLabel} onChange={(e) => setSubLabel(e.target.value)} placeholder={subSize ? `${subSize}${subUnitLabel}` : 'e.g. Small sachet'} />
              </div>
              <div className="fld" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
                <label className="lab" htmlFor="subprice">Selling price (KES)</label>
                <input className="inp mono" id="subprice" value={subPrice} onChange={(e) => setSubPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 100" />
              </div>
              <button type="button" className="btn btn-o btn-sm" onClick={addSubdivision} disabled={!subSize || !subPrice}>
                <Icon name="plus" size={13} />Add portion
              </button>
            </div>
            {liveEstimate && (
              <p className="hint" style={{ marginTop: 6 }}>
                Costs you about <b className="mono">{kes(liveEstimate.cost)}</b> to make this portion.
                {liveEstimate.profit != null && (
                  <> {liveEstimate.profit >= 0
                    ? <>Profit: <b className="mono" style={{ color: 'var(--green)' }}>{kes(liveEstimate.profit)}</b>.</>
                    : <span style={{ color: 'var(--red)' }}> That's a {kes(Math.abs(liveEstimate.profit))} loss at this price.</span>}
                  </>
                )}
              </p>
            )}
            <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 8 }} onClick={() => { setSubdividing(false); setSubdivisions([]); }}>
              Don't subdivide this
            </button>
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-p" onClick={submit} disabled={pending || !name.trim() || !price}>
          {pending ? 'Adding…' : 'Add product'}
        </button>
        <button type="button" className="btn btn-o" onClick={reset}>Cancel</button>
      </div>
      <p className="hint">Prices don't have to be fixed — you can still knock a bit off at the till when a customer bargains.</p>
      {error && <p className="err" role="alert" style={{ marginTop: 10 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
