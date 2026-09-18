'use client';

import { useState } from 'react';

// A starting set, not an exhaustive one — role is a plain string on
// the backend (see dbx's CourierTeamMember.role comment), so "many
// more titles" than this list is always one custom entry away rather
// than a schema change.
export const ROLE_PRESETS = ['MANAGER', 'DIRECTOR', 'DISPATCHER', 'DRIVER', 'MEMBER'];
const OTHER = 'Other';

const FIELD: React.CSSProperties = { display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 };

/**
 * A role/title picker — the common presets in a dropdown, plus
 * "Other" revealing a free-text field for anything not listed
 * (Director, Coordinator, whatever a given team actually calls it).
 * Every "Other"-shaped choice in this app pairs with its own free-text
 * input rather than silently discarding what doesn't fit the preset
 * list.
 */
export function RoleField({
  value, onChange, label = 'Role', presets = ROLE_PRESETS,
}: {
  value: string;
  onChange: (role: string) => void;
  label?: string;
  /** The presets offered before "Other…". Different callers have
   *  different vocabularies — a courier team's titles aren't a courier
   *  company's staff roles — so this is a prop rather than a fixed list. */
  presets?: string[];
}) {
  const isPreset = presets.includes(value);
  const [customMode, setCustomMode] = useState(value !== '' && !isPreset);

  return (
    <div>
      <label className="sub">{label}
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
          placeholder="Enter a title"
          style={{ ...FIELD, marginTop: 6 }}
        />
      )}
    </div>
  );
}
