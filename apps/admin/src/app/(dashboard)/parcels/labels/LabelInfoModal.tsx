'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionAttachParcelLabelInfo, type ParcelLabelInfoInput } from '../actions';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

// A practical, small taxonomy for what's physically stuck on a
// pre-printed label — deliberately not the same list as ParcelType
// (the pricing-bracket enum a real booking uses): this is filled in
// by a handler eyeballing an item in the field, before any weighing
// or pricing happens, so it favours "what does this look like" over
// a pricing category.
const ITEM_TYPE_OPTIONS = [
  'Luggage / Suitcase', 'Backpack', 'Box / Carton', 'Envelope / Document',
  'Electronics', 'Furniture', 'Other',
];

const WEIGHT_RANGE_OPTIONS = ['Under 1kg', '1–5kg', '5–10kg', '10–20kg', '20kg+'];

const INPUT: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2,
};

/**
 * The "fill in" half of the pre-printed-label pipeline: a handler has
 * just stuck a label on a real item — this is where that gets written
 * down, without needing to run the item through a full sender/
 * receiver/pricing/payment booking (or ever, if it never needs one).
 * core-go's guest-safe scan/track endpoint then shows this same info
 * to anyone who scans the code — see dbx.GetParcelStatus's own
 * comment on the fallback.
 *
 * Opened by clicking a label's QR in the printed batch/pool grid (see
 * LabelStockPanel) — `initialCode` arrives pre-filled and locked, since
 * the whole point of that entry point is "this specific label, right
 * here". `initialCode` being undefined instead opens it in "type any
 * code" mode, for attaching info to a label that isn't in the current
 * on-screen batch (e.g. one printed in an earlier session).
 */
export function LabelInfoModal({ initialCode, onClose }: { initialCode?: string; onClose: () => void }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [itemDescription, setItemDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerContact, setOwnerContact] = useState('');
  const [ownerGender, setOwnerGender] = useState('');
  const [itemType, setItemType] = useState('');
  const [weightRangeKg, setWeightRangeKg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function submit() {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedDescription = itemDescription.trim();
    if (!trimmedCode || !trimmedDescription) {
      setError('The label code and a short item description are both required.');
      return;
    }
    setError(null);
    const info: ParcelLabelInfoInput = {
      itemDescription: trimmedDescription,
      destination: destination.trim() || undefined,
      ownerName: ownerName.trim() || undefined,
      ownerContact: ownerContact.trim() || undefined,
      ownerGender: ownerGender || undefined,
      itemType: itemType || undefined,
      weightRangeKg: weightRangeKg || undefined,
    };
    startTransition(async () => {
      const result = await actionAttachParcelLabelInfo(trimmedCode, info);
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      announce(`Info attached to ${trimmedCode}`, 'assertive');
    });
  }

  return (
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="label-info-title">
        <div className="modal-hd">
          <div>
            <h2 id="label-info-title">Attach info to a label</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              No booking required — a handler (or anyone who scans/tracks the code) sees this
              once it's saved.
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          {saved ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Icon name="check-circle" size={32} />
              <p style={{ margin: '10px 0 0', fontWeight: 700 }}>Saved for {code.trim().toUpperCase()}</p>
              <button className="btn btn-o btn-sm" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Label code
                <input className="mono" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="PKG-XXXXXX" readOnly={!!initialCode}
                  style={{ ...INPUT, background: initialCode ? 'var(--paper)' : undefined }} />
              </label>

              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Item description
                <input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="e.g. TV stand, flat-pack box" style={INPUT} />
              </label>

              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Destination
                <input value={destination} onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Westlands, Nairobi" style={INPUT} />
              </label>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <label className="sub" style={{ flex: 1 }}>Item owner
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Full name" style={INPUT} />
                </label>
                <label className="sub" style={{ flex: 1 }}>Owner contact
                  <input value={ownerContact} onChange={(e) => setOwnerContact(e.target.value)}
                    placeholder="Phone or email" style={INPUT} />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <label className="sub" style={{ flex: 1 }}>Gender
                  <select value={ownerGender} onChange={(e) => setOwnerGender(e.target.value)} style={INPUT}>
                    <option value="">—</option>
                    {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="sub" style={{ flex: 1 }}>Item type
                  <select value={itemType} onChange={(e) => setItemType(e.target.value)} style={INPUT}>
                    <option value="">—</option>
                    {ITEM_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="sub" style={{ flex: 1 }}>Weight range
                  <select value={weightRangeKg} onChange={(e) => setWeightRangeKg(e.target.value)} style={INPUT}>
                    <option value="">—</option>
                    {WEIGHT_RANGE_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
              </div>

              <button className="btn btn-p btn-sm" disabled={pending} onClick={submit}>
                {pending ? 'Saving…' : 'Save'}
              </button>
              {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
