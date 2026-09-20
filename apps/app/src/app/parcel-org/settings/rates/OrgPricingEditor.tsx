'use client';

import { useId, useState, useTransition } from 'react';
import type { OrgPricingRow } from '../../actions';
import { saveOrgPricing } from '../../actions';

const TYPE_LABEL: Record<string, string> = {
  ENVELOPE_DOCUMENT: 'Envelope / Document',
  SMALL: 'Small parcel',
  MEDIUM: 'Medium parcel',
  LARGE: 'Large parcel',
  HEAVY_OVERSIZE: 'Heavy / Oversize',
};

/**
 * One row per parcel type, each independently editable and saved. What
 * a row shows right now is exactly what a sender's own quote resolves
 * to (see handleListMyOrgPricing's own comment) — this screen has no
 * separate "preview" number, so there's nothing here that could disagree
 * with what a customer is actually quoted.
 */
export function OrgPricingEditor({ pricing }: { pricing: OrgPricingRow[] }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Type</th><th>Weight</th><th>Min (KES)</th><th>Max (KES)</th><th /></tr>
          </thead>
          <tbody>
            {pricing.map((p) => <PricingRow key={p.parcelType} row={p} />)}
            {pricing.length === 0 && (
              <tr>
                <td colSpan={5} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  Nothing priced on the platform yet — ask Esoqo to set up the standard rate card first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricingRow({ row }: { row: OrgPricingRow }) {
  const [editing, setEditing] = useState(false);
  const [minKes, setMinKes] = useState(row.minKes);
  const [maxKes, setMaxKes] = useState(row.maxKes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { min: useId(), max: useId() };

  if (editing) {
    return (
      <tr>
        <td colSpan={5} style={{ padding: 14 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <strong>{TYPE_LABEL[row.parcelType] ?? row.parcelType}</strong>
            <div className="row" style={{ gap: 12 }}>
              <div>
                <label className="sub" htmlFor={ids.min} style={{ display: 'block', marginBottom: 4 }}>Min (KES)</label>
                <input id={ids.min} className="mono" inputMode="numeric" value={minKes}
                  onChange={(e) => setMinKes(e.target.value.replace(/[^\d.]/g, ''))}
                  style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, width: 120 }} />
              </div>
              <div>
                <label className="sub" htmlFor={ids.max} style={{ display: 'block', marginBottom: 4 }}>Max (KES)</label>
                <input id={ids.max} className="mono" inputMode="numeric" value={maxKes}
                  onChange={(e) => setMaxKes(e.target.value.replace(/[^\d.]/g, ''))}
                  style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, width: 120 }} />
              </div>
            </div>
            {error && <p className="sub" style={{ color: 'var(--red)' }}>{error}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-p btn-sm" disabled={pending} onClick={() => {
                setError(null);
                const min = Number(minKes);
                const max = Number(maxKes);
                if (!min || min <= 0 || max < min) {
                  setError('Min must be positive and max must be at least min');
                  return;
                }
                startTransition(async () => {
                  const result = await saveOrgPricing({ parcelType: row.parcelType, minKes: min, maxKes: max });
                  if (!result.ok) { setError(result.error); return; }
                  setEditing(false);
                });
              }}>
                {pending ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-o btn-sm" disabled={pending} onClick={() => {
                setMinKes(row.minKes); setMaxKes(row.maxKes); setError(null); setEditing(false);
              }}>
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{TYPE_LABEL[row.parcelType] ?? row.parcelType}</td>
      <td className="sub">{row.weightLabel}</td>
      <td className="mono">{row.minKes}</td>
      <td className="mono">{row.maxKes}</td>
      <td style={{ textAlign: 'right' }}>
        <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </td>
    </tr>
  );
}
