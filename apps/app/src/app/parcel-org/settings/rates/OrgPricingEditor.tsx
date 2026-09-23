'use client';

import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
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
 *
 * Rows rather than a table: the price is a RANGE, and a table split it
 * across two numeric columns a manager had to read back together. A row
 * can show "KES 200 – 400" as the one fact it is, and it restacks on a
 * phone without the five-column horizontal scroll the table needed.
 */
/** Smallest first. The server returns rate rows in its own order,
 *  which put Heavy/Oversize above Large — a size ladder that goes
 *  22.5kg then 9kg reads as a mistake even when every number is right. */
const TYPE_ORDER = Object.keys(TYPE_LABEL);
function bySize(a: OrgPricingRow, b: OrgPricingRow): number {
  const ia = TYPE_ORDER.indexOf(a.parcelType);
  const ib = TYPE_ORDER.indexOf(b.parcelType);
  // An unknown type sorts last rather than to the front on -1.
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
}

export function OrgPricingEditor({ pricing }: { pricing: OrgPricingRow[] }) {
  if (pricing.length === 0) {
    return (
      <div className="ppanel">
        <div className="pempty">
          <span className="pempty-icon"><Icon name="tag" size={20} /></span>
          <strong>No rate card yet</strong>
          <p>
            Nothing is priced on the platform yet — ask Esoqo to set up the standard
            rate card, then set your own prices against it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="plist porg-rates">
      {[...pricing].sort(bySize).map((p) => <PricingRow key={p.parcelType} row={p} />)}
    </ul>
  );
}

function PricingRow({ row }: { row: OrgPricingRow }) {
  const [editing, setEditing] = useState(false);
  const [minKes, setMinKes] = useState(row.minKes);
  const [maxKes, setMaxKes] = useState(row.maxKes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { min: useId(), max: useId() };

  const label = TYPE_LABEL[row.parcelType] ?? row.parcelType;

  function save() {
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
  }

  function cancel() {
    setMinKes(row.minKes); setMaxKes(row.maxKes); setError(null); setEditing(false);
  }

  if (editing) {
    return (
      <li className="is-editing">
        <div className="plist-main">
          <span className="plist-title">{label}</span>
          <span className="plist-sub">{row.weightLabel}</span>

          <div className="pgrid porg-rates-edit">
            <div className="pfield">
              <label htmlFor={ids.min}>Min (KES)</label>
              <input
                id={ids.min} className="mono" inputMode="decimal" value={minKes}
                onChange={(e) => setMinKes(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <div className="pfield">
              <label htmlFor={ids.max}>Max (KES)</label>
              <input
                id={ids.max} className="mono" inputMode="decimal" value={maxKes}
                onChange={(e) => setMaxKes(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          </div>

          {error && (
            <p className="pnote pnote-bad" role="alert">
              <Icon name="alert-circle" size={16} /><span>{error}</span>
            </p>
          )}

          <div className="ptoolbar" style={{ marginBottom: 0 }}>
            <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-o btn-sm" disabled={pending} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="plist-main">
        <span className="plist-title">{label}</span>
        <span className="plist-sub">{row.weightLabel}</span>
      </div>
      <span className="porg-rate-range mono">
        KES {row.minKes} <span aria-hidden="true">–</span> {row.maxKes}
      </span>
      <div className="plist-actions">
        <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>
          <Icon name="tag" size={14} />Edit
        </button>
      </div>
    </li>
  );
}
