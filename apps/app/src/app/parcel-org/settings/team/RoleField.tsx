'use client';

import { useState } from 'react';

/** The roles a company gets out of the box. Role is a free label on the
 *  backend, so "Other…" lets a depot call a job whatever it actually
 *  calls it; a custom role signs in with rider-level capabilities, the
 *  same safe fallback core-go applies to an unrecognised role. */
export const PARCEL_STAFF_ROLES = ['RIDER', 'DISPATCHER', 'MANAGER'];
const OTHER = 'Other';

const FIELD: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6,
  width: '100%', marginTop: 2,
};

/**
 * A role picker — the company's usual roles, plus "Other…" revealing a
 * free-text field. Mirrors the admin app's RoleField so a manager and an
 * admin enter the same kind of title.
 */
export function RoleField({ value, onChange, label = 'Role', presets = PARCEL_STAFF_ROLES }: {
  value: string;
  onChange: (role: string) => void;
  label?: string;
  presets?: string[];
}) {
  const isPreset = presets.includes(value);
  const [customMode, setCustomMode] = useState(value !== '' && !isPreset);

  return (
    <div>
      <label className="sub" style={{ display: 'block', marginBottom: 4 }}>{label}
        <select
          value={customMode ? OTHER : (isPreset ? value : (value || presets[0]))}
          onChange={(e) => {
            if (e.target.value === OTHER) { setCustomMode(true); onChange(''); }
            else { setCustomMode(false); onChange(e.target.value); }
          }}
          style={FIELD}
        >
          {presets.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value={OTHER}>Other…</option>
        </select>
      </label>
      {customMode && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter a role"
          style={{ ...FIELD, marginTop: 6 }}
        />
      )}
    </div>
  );
}
