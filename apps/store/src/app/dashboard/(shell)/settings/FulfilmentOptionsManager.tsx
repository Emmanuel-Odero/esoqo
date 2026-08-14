'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { addFulfilmentOption, toggleFulfilmentOption } from './actions';

interface Option { id: string; kind: string; label: string; feeKes: number; active: boolean }

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function FulfilmentOptionsManager({ storeId, options }: { storeId: string; options: Option[] }) {
  const [kind, setKind] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [label, setLabel] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addFulfilmentOption(storeId, { kind, label, feeKes: fee === '' ? 0 : Number(fee) });
      if (!result.ok) { setError(result.error); return; }
      setLabel(''); setFee(''); router.refresh();
    });
  }

  function toggle(id: string, active: boolean) {
    startTransition(async () => { await toggleFulfilmentOption(id, active); router.refresh(); });
  }

  return (
    <div className="field-group">
      <h3>Delivery &amp; pickup</h3>
      {options.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {options.map((o) => (
            <div key={o.id} className="review-line">
              <span>{o.kind === 'PICKUP' ? <Icon name="shop" size={13} /> : <Icon name="truck" size={13} />} {o.label} — {o.feeKes > 0 ? kes(o.feeKes) : 'Free'}</span>
              <button type="button" className="btn btn-o btn-sm" onClick={() => toggle(o.id, !o.active)} disabled={pending}>
                {o.active ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label className="lab" htmlFor="fkind">Type</label>
          <select className="inp" id="fkind" value={kind} onChange={(e) => setKind(e.target.value as 'PICKUP' | 'DELIVERY')}>
            <option value="PICKUP">Pickup</option>
            <option value="DELIVERY">Delivery</option>
          </select>
        </div>
        <div className="fld" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="flabel">Description</label>
          <input className="inp" id="flabel" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pickup at Kawangware" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="lab" htmlFor="ffee">Fee (KES)</label>
          <input className="inp mono" id="ffee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0" />
        </div>
        <button type="button" className="btn btn-p btn-sm" onClick={submit} disabled={pending || !label.trim()}>Add</button>
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 8 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
