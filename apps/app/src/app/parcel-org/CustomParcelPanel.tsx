'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { addCustomParcel } from './actions';

const PARCEL_TYPES: [value: string, label: string][] = [
  ['ENVELOPE_DOCUMENT', 'Envelope / document'],
  ['SMALL', 'Small'],
  ['MEDIUM', 'Medium'],
  ['LARGE', 'Large'],
  ['HEAVY_OVERSIZE', 'Heavy / oversize'],
];

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '9px 11px',
  border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.92rem',
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px',
  background: 'var(--paper)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0, fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--tx-2)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 10, marginTop: 8,
};

/**
 * Add a parcel with your own number — for work that starts on paper or
 * in another book and still needs to be managed and tracked here. Your
 * number stays on the parcel and is searchable; Esoqo mints a tracking
 * code for it and shows it back so it can go on the box.
 */
export function CustomParcelPanel() {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [parcelType, setParcelType] = useState('SMALL');
  const [weightKg, setWeightKg] = useState('');
  const [fragile, setFragile] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setNumber(''); setSenderName(''); setSenderMsisdn('');
    setReceiverName(''); setReceiverMsisdn(''); setOriginLabel(''); setDestinationLabel('');
    setParcelType('SMALL'); setWeightKg(''); setFragile(false); setNotes('');
  }

  const ready = number.trim() && senderName.trim() && senderMsisdn.trim()
    && receiverName.trim() && receiverMsisdn.trim()
    && originLabel.trim() && destinationLabel.trim();

  function save() {
    setError(null); setMinted(null);
    startTransition(async () => {
      const result = await addCustomParcel({
        externalRef: number,
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType,
        weightKg: weightKg.trim() ? Number(weightKg) : null, fragile, notes,
      });
      if (!result.ok) { setError(result.error); return; }
      setMinted(result.code);
      reset();
    });
  }

  if (!open) {
    return (
      <button className="btn btn-o btn-sm" onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>
        <Icon name="plus" size={14} />Add a custom parcel
      </button>
    );
  }

  return (
    <section className="card" style={{ marginBottom: 18, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Add a custom parcel</h2>
          <p className="sub" style={{ margin: '4px 0 0', maxWidth: '70ch' }}>
            Use your own parcel number — it stays on the parcel and is searchable here. Esoqo
            gives it a tracking code so you can manage and track it like any other.
          </p>
        </div>
        <button className="btn btn-o btn-sm" aria-label="Close" disabled={pending}
          onClick={() => { reset(); setOpen(false); setError(null); setMinted(null); }}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {minted && (
        <div className="chain ok" style={{ margin: '14px 0 0' }}>
          <Icon name="check-circle" size={16} />
          <span>Saved. Tracking code: <strong className="mono">{minted}</strong></span>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Parcel number</h3>
          <div style={gridStyle}>
            <label className="sub">Your number
              <input style={inputStyle} className="mono" value={number} placeholder="e.g. SWIFT-00471"
                onChange={(e) => setNumber(e.target.value)} />
            </label>
            <label className="sub">Parcel type
              <select style={inputStyle} value={parcelType} onChange={(e) => setParcelType(e.target.value)}>
                {PARCEL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Sender</h3>
          <div style={gridStyle}>
            <label className="sub">Name
              <input style={inputStyle} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
            </label>
            <label className="sub">Phone
              <input style={inputStyle} className="mono" value={senderMsisdn} placeholder="07…" inputMode="tel"
                onChange={(e) => setSenderMsisdn(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Receiver</h3>
          <div style={gridStyle}>
            <label className="sub">Name
              <input style={inputStyle} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </label>
            <label className="sub">Phone
              <input style={inputStyle} className="mono" value={receiverMsisdn} placeholder="07…" inputMode="tel"
                onChange={(e) => setReceiverMsisdn(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Journey</h3>
          <div style={gridStyle}>
            <label className="sub">From
              <input style={inputStyle} value={originLabel} placeholder="e.g. Nairobi CBD"
                onChange={(e) => setOriginLabel(e.target.value)} />
            </label>
            <label className="sub">To
              <input style={inputStyle} value={destinationLabel} placeholder="e.g. Nakuru"
                onChange={(e) => setDestinationLabel(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Package</h3>
          <div style={gridStyle}>
            <label className="sub">Weight (kg, optional)
              <input style={inputStyle} className="mono" value={weightKg} inputMode="decimal"
                onChange={(e) => setWeightKg(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
            <label className="sub">Notes (optional)
              <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <label className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
            Fragile — handle with care
          </label>
        </fieldset>
      </div>

      {error && <p role="alert" className="sub" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-p btn-sm" disabled={pending || !ready} onClick={save}>
          {pending ? 'Saving…' : 'Save parcel'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending}
          onClick={() => { reset(); setOpen(false); setError(null); }}>
          Close
        </button>
      </div>
    </section>
  );
}
