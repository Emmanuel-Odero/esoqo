'use client';

import { useState } from 'react';
import { PRODUCT_UNITS } from '@esoko/domain';

const OTHER = '__other__';

/**
 * "How do you sell this?" — a picker, not a text box, because a
 * first-time merchant staring at a blank "unit" field has no idea what
 * to type. Still lands on a free-text value in the end (see
 * createProductSchema's unit field) — picking "Other" swaps to a plain
 * input for whatever their own trade calls it ("debe", "gorogoro"…).
 */
export function UnitPicker({ id, value, onChange, emptyLabel = 'Not sold by unit — one price for the whole item' }: {
  id: string; value: string; onChange: (unit: string) => void; emptyLabel?: string;
}) {
  const known = PRODUCT_UNITS.some(([k]) => k === value);
  const [customising, setCustomising] = useState(value !== '' && !known);

  if (customising) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="inp" id={id} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. debe, gorogoro, bundle…"
        />
        <button
          type="button" className="btn btn-o btn-sm"
          onClick={() => { setCustomising(false); onChange(''); }}
        >
          Pick from list
        </button>
      </div>
    );
  }

  return (
    <select
      className="inp" id={id} value={value}
      onChange={(e) => {
        if (e.target.value === OTHER) { setCustomising(true); onChange(''); return; }
        onChange(e.target.value);
      }}
    >
      <option value="">{emptyLabel}</option>
      {PRODUCT_UNITS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      <option value={OTHER}>Something else…</option>
    </select>
  );
}
