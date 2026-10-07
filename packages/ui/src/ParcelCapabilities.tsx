'use client';

/**
 * A custom parcel-company role's permissions, as a checklist.
 *
 * The values mirror core-go's parcel capabilities verbatim
 * (services/core-go/internal/authsvc/capabilities.go's CapParcelOrg*).
 * The backend sanitizes every submitted list against that same set, so a
 * stale or hand-edited entry here can never grant anything the server
 * doesn't already know — this list only decides what an owner can tick.
 */
export interface ParcelCapabilityOption {
  value: string;
  label: string;
  hint: string;
}

export const PARCEL_CAPABILITIES: ParcelCapabilityOption[] = [
  { value: 'parcelorg.read', label: 'See the company’s parcels', hint: 'Open the console and read parcels, statuses and the day’s figures.' },
  { value: 'parcelorg.carry', label: 'Carry & close parcels', hint: 'Take custody, log delivery attempts and hand over at the door.' },
  { value: 'parcelorg.dispatch', label: 'Assign work', hint: 'Assign parcels to riders and manage the dispatch queue.' },
  { value: 'parcelorg.intake', label: 'Receive drop-offs', hint: 'Check in parcels a sender brings to the counter.' },
  { value: 'parcelorg.arrival', label: 'Log arrivals', hint: 'Mark parcels as arrived at a station or hub.' },
  { value: 'parcelorg.collection', label: 'Release collections', hint: 'Hand a parcel to the receiver at a counter.' },
  { value: 'parcelorgstation.write', label: 'Manage stations', hint: 'Add and edit pickup and drop-off points.' },
  { value: 'parcelorgstaff.write', label: 'Manage the team', hint: 'Add, edit and suspend staff, and set their roles.' },
  { value: 'parcelorg.write', label: 'Company profile & pricing', hint: 'Edit the company details and its rate card.' },
  { value: 'parcelorg.earnings', label: 'See earnings', hint: 'View what the company earned and the cash owed.' },
  { value: 'parcelorg.counter-cash', label: 'Count counter cash in', hint: 'Close out the cash a clerk collected at the counter.' },
];

/** The RIDER floor core-go applies to a role with no preset and no
 *  explicit permissions — the sensible starting ticks for a fresh
 *  custom role. */
export const RIDER_BASELINE = ['parcelorg.read', 'parcelorg.carry'];

export function ParcelCapabilityPicker({
  value, onChange, disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (cap: string) =>
    onChange(value.includes(cap) ? value.filter((c) => c !== cap) : [...value, cap]);

  return (
    <fieldset
      style={{
        border: '1.5px solid var(--line)', borderRadius: 8, padding: '10px 12px',
        display: 'grid', gap: 8, margin: 0,
      }}
    >
      <legend className="sub" style={{ padding: '0 6px' }}>What can they do?</legend>
      {PARCEL_CAPABILITIES.map((c) => (
        <label key={c.value} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <input
            type="checkbox" checked={value.includes(c.value)} disabled={disabled}
            onChange={() => toggle(c.value)} style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600, fontSize: '.9rem' }}>{c.label}</span>
            <span className="sub" style={{ display: 'block', fontSize: '.78rem' }}>{c.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
