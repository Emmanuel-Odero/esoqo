'use client';
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

/**
 * A <select> that reveals a free-text field the moment its "Other"
 * option is picked — the pattern this product uses everywhere a fixed
 * list of choices (org kind, role, business type, product unit, store
 * category...) can't cover every real answer. Before this component
 * existed, every one of those pickers hand-rolled the same three
 * pieces: an OTHER sentinel value, a second bit of state for the free
 * text, and a conditional <input> — see GroupManager.tsx (admin),
 * WalkInFlow.tsx/WhoAndName.tsx (join flow), UnitPicker.tsx and
 * StoreProfileEditor.tsx (store) for the versions this replaces.
 *
 * Deliberately keeps the caller's two-piece state shape (a selected
 * value plus a separate free-text value) rather than merging them into
 * one field, because that is what every one of those call sites was
 * already storing — Membership.role/customRole, Organisation.kind/
 * kindOther, and so on all persist the picked option and the free text
 * separately, and a merged single-field API would just make callers
 * split it straight back apart.
 */

export interface SelectWithOtherOption {
  value: string;
  label: string;
}

export interface SelectWithOtherProps {
  id: string;
  /** Omit to render a bare <select>+<input> pair with no <label> of
   *  their own — for callers embedding this inside a row that already
   *  labels the field some other way (a table cell, for instance). */
  label?: string;
  options: readonly (SelectWithOtherOption | readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  /** Which option value means "let me type my own". Defaults to
   *  'OTHER', the convention every existing call site already used —
   *  only override this for a picker that predates that convention
   *  (see UnitPicker.tsx's '__other__'). */
  otherValue?: string;
  customValue: string;
  onCustomChange: (value: string) => void;
  customLabel?: string;
  customPlaceholder?: string;
  /** Marks the custom field required once shown — the select itself is
   *  never marked required by this component; callers that need the
   *  base selection required should set it on their own <select>
   *  wiring, since a default option is usually already a valid choice. */
  required?: boolean;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  /** Skip the .fld wrapper divs and <label>s, rendering just the
   *  <select> and (when shown) the <input> as bare siblings — for a
   *  caller embedding this in a layout it already controls (a compact
   *  table/list row, say) rather than a standalone form field. */
  bare?: boolean;
  /** Escape hatch for anything this component doesn't name explicitly —
   *  aria-label, style, onKeyDown, etc. — spread onto the underlying
   *  <select>/<input> after this component's own props, so a caller
   *  can override value/onChange/id/className too if it really needs
   *  to (it shouldn't normally need to). */
  selectProps?: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

function normaliseOptions(options: SelectWithOtherProps['options']): SelectWithOtherOption[] {
  return options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : (o as SelectWithOtherOption)));
}

export function SelectWithOther({
  id, label, options, value, onChange, otherValue = 'OTHER',
  customValue, onCustomChange, customLabel = 'Please specify', customPlaceholder,
  required = false, disabled = false, className = 'inp', labelClassName = 'lab', bare = false,
  selectProps, inputProps,
}: SelectWithOtherProps) {
  const opts = normaliseOptions(options);
  const isOther = value === otherValue;

  const select = (
    <select
      id={id} className={className} value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      {...selectProps}
    >
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const customInput = isOther && (
    <input
      id={`${id}-other`} className={className} value={customValue}
      onChange={(e) => onCustomChange(e.target.value)}
      placeholder={customPlaceholder} required={required} disabled={disabled}
      {...inputProps}
    />
  );

  if (bare) {
    return <>{select}{customInput}</>;
  }

  return (
    <>
      <div className="fld">
        {label && <label className={labelClassName} htmlFor={id}>{label}</label>}
        {select}
      </div>
      {isOther && (
        <div className="fld">
          {label && <label className={labelClassName} htmlFor={`${id}-other`}>{customLabel}</label>}
          {customInput}
        </div>
      )}
    </>
  );
}

/**
 * True once a SelectWithOther is in a submittable state — either a
 * non-"other" value is picked, or "other" is picked and the free text
 * isn't blank. Every call site was re-deriving this inline for its
 * submit-button disabled state; this is that one check, named.
 */
export function isSelectWithOtherComplete(value: string, customValue: string, otherValue = 'OTHER'): boolean {
  return value !== otherValue || customValue.trim().length > 0;
}

/**
 * The label to actually show/store once a SelectWithOther has been
 * filled in — the free text when "other" was picked and given, the
 * matching option's label otherwise, falling back to the raw value if
 * it's not in the list (defensive only; every caller passes the same
 * options it rendered).
 */
export function resolveSelectWithOtherLabel(
  value: string, customValue: string, options: SelectWithOtherProps['options'], otherValue = 'OTHER',
): string {
  if (value === otherValue) return customValue.trim() || 'Other';
  return normaliseOptions(options).find((o) => o.value === value)?.label ?? value;
}
