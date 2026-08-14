'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@esoko/ui';

/**
 * The debounced search-as-you-type input used across /join — what work
 * someone does, which group they belong to, which business they run.
 * Three call sites used to hand-roll the same role="combobox"/
 * role="listbox" markup and "always affirm, never dead-end" fallback
 * (see packages/domain/src/segments.ts's file header for why that
 * fallback matters). This is the one implementation.
 *
 * The debounce timer itself stays with each caller — they own the
 * server round trip (actionSearchWork / actionSearchGroups /
 * actionSearchBusinesses) and what "no matches" should announce, since
 * the right wording differs by what's being searched.
 */
export interface SearchComboboxProps<H> {
  id: string;
  label: string;
  icon?: IconName;
  value: string;
  onInputChange: (v: string) => void;
  placeholder?: string;
  hits: H[];
  getKey: (h: H) => string;
  isSelected: (h: H) => boolean;
  onSelect: (h: H) => void;
  renderHit: (h: H) => ReactNode;
  hint?: string;
  errField?: string;
  /** The fallback row shown when nothing matched and the typed value is
   *  long enough to have searched — omit to require picking from the
   *  list (e.g. linking to a party that must already exist). */
  noMatchLabel?: (typed: string) => string;
  onNoMatchSelect?: (typed: string) => void;
  minChars?: number;
}

export function SearchCombobox<H>({
  id, label, icon, value, onInputChange, placeholder, hits, getKey, isSelected,
  onSelect, renderHit, hint, errField, noMatchLabel, onNoMatchSelect, minChars = 2,
}: SearchComboboxProps<H>) {
  const hitsId = `${id}-hits`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="fld">
      <label className="lab" htmlFor={id}>{icon && <Icon name={icon} size={15} />}{label}</label>
      <input
        className="inp" id={id} value={value} autoComplete="off"
        role="combobox" aria-expanded={hits.length > 0} aria-controls={hitsId}
        aria-invalid={errField === id} aria-describedby={hintId}
        onChange={(e) => onInputChange(e.target.value)} placeholder={placeholder}
      />
      <div className="hits" id={hitsId} role="listbox" aria-label={`Matching ${label.toLowerCase()}`}>
        {hits.map((h) => (
          <button
            key={getKey(h)} type="button" className="hit" role="option"
            aria-selected={isSelected(h)} onClick={() => onSelect(h)}
          >
            {renderHit(h)}
            <span className="yes">SELECT</span>
          </button>
        ))}
        {noMatchLabel && onNoMatchSelect && value.trim().length >= minChars && hits.length === 0 && (
          <button type="button" className="hit" onClick={() => onNoMatchSelect(value)}>
            <span>{noMatchLabel(value)}</span>
            <span className="yes">SELECT</span>
          </button>
        )}
      </div>
      {hint && <p className="hint" id={hintId}>{hint}</p>}
    </div>
  );
}
