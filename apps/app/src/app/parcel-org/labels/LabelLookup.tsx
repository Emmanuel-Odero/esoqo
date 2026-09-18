'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgParcelLabel } from '@/lib/parcel-org-session';
import { attachOrgLabelInfo, resolveOrgLabel } from '../actions';

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px',
  border: '1.5px solid var(--line)', borderRadius: 6,
};

const STATE_LABEL: Record<string, string> = {
  blank: 'Blank — nothing written on it yet',
  filled: 'Filled in — details attached, not yet booked',
  spent: 'Used — bound to a booked parcel',
  voided: 'Withdrawn — can never be used',
};

/**
 * Scan or type a label code and see what it is — the org-scoped
 * equivalent of holding the physical sticker up to the page. Works for
 * anyone on the company; a foreign or unknown code fails identically.
 * When the label is still writable and the caller can dispatch, the
 * notes form below offers itself instead of a second trip to a
 * different screen.
 */
export function LabelLookup({ canManage }: { canManage: boolean }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState<OrgParcelLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function lookup() {
    setError(null);
    setLabel(null);
    const ref = code.trim();
    if (!ref) return;
    startTransition(async () => {
      const res = await resolveOrgLabel(ref);
      if (!res.ok) { setError(res.error); return; }
      setLabel(res.label);
    });
  }

  const writable = label && (label.state === 'blank' || label.state === 'filled') && canManage;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <label className="sub" htmlFor="label-scan" style={{ display: 'block', marginBottom: 6 }}>
        Scan or type a label code
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id="label-scan" className="mono" value={code}
          placeholder="PKG-XXXXXX"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }}
        />
        <button className="btn btn-p btn-sm" disabled={pending || !code.trim()} onClick={lookup}>
          {pending ? 'Looking up…' : 'Look up'}
        </button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}

      {label && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <strong className="mono">{label.code}</strong>
            <span className={`pill ${label.state === 'blank' ? 'p-mute' : label.state === 'voided' ? 'p-bad' : label.state === 'spent' ? 'p-ok' : 'p-info'}`}>
              {STATE_LABEL[label.state] ?? label.state}
            </span>
          </div>
          {(label.itemDescription || label.destination || label.senderName || label.receiverName) ? (
            <dl className="dl-grid" style={{ margin: 0 }}>
              {label.itemDescription && (<><dt className="sub">Item</dt><dd>{label.itemDescription}</dd></>)}
              {label.destination && (<><dt className="sub">Destination</dt><dd>{label.destination}</dd></>)}
              {(label.senderName || label.senderMsisdn) && (
                <><dt className="sub">Sender</dt><dd>{[label.senderName, label.senderMsisdn].filter(Boolean).join(' · ')}</dd></>)}
              {(label.receiverName || label.receiverMsisdn) && (
                <><dt className="sub">Receiver</dt><dd>{[label.receiverName, label.receiverMsisdn].filter(Boolean).join(' · ')}</dd></>)}
            </dl>
          ) : (
            <p className="sub" style={{ margin: '0 0 8px' }}>No details written on this label yet.</p>
          )}
          {label.parcelCode && (
            <p style={{ margin: '8px 0 0' }}>
              <span className="sub">Bound to parcel </span>
              <strong className="mono">{label.parcelCode}</strong>
              {label.parcelStatus && <span className="sub"> · {label.parcelStatus.replace(/_/g, ' ').toLowerCase()}</span>}
            </p>
          )}
          {writable && label && (
            <AttachLabelForm code={label.code} initial={label} onSaved={(refreshed) => setLabel(refreshed)} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The "custom labels entry" — write what's on the box onto a printed
 * label: item, destination, sender and receiver. Overwrites whatever was
 * there (the server keeps no history), and refuses once spent.
 */
function AttachLabelForm({
  code, initial, onSaved,
}: { code: string; initial: OrgParcelLabel; onSaved: (label: OrgParcelLabel) => void }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState(initial.itemDescription ?? '');
  const [destination, setDestination] = useState(initial.destination ?? '');
  const [senderName, setSenderName] = useState(initial.senderName ?? '');
  const [senderMsisdn, setSenderMsisdn] = useState(initial.senderMsisdn ?? '');
  const [receiverName, setReceiverName] = useState(initial.receiverName ?? '');
  const [receiverMsisdn, setReceiverMsisdn] = useState(initial.receiverMsisdn ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        <Icon name="document" size={13} />Write details on this label
      </button>
    );
  }

  function save() {
    setError(null);
    if (!item.trim()) { setError('Describe the item — that is the one required field.'); return; }
    startTransition(async () => {
      const result = await attachOrgLabelInfo(code, {
        itemDescription: item,
        destination, senderName, senderMsisdn, receiverName, receiverMsisdn,
      });
      if (!result.ok) { setError(result.error); return; }
      // Re-read: the server is the record, and the lookup card should
      // show exactly what it now holds.
      const refreshed = await resolveOrgLabel(code);
      if (refreshed.ok) onSaved(refreshed.label);
      setOpen(false);
    });
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <label className="sub">What&apos;s on the box
        <input style={inputStyle} value={item} placeholder="e.g. Shoes, size 42"
          onChange={(e) => setItem(e.target.value)} />
      </label>
      <label className="sub">Destination
        <input style={inputStyle} value={destination} placeholder="e.g. Nakuru"
          onChange={(e) => setDestination(e.target.value)} />
      </label>
      <label className="sub">Sender name
        <input style={inputStyle} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
      </label>
      <label className="sub">Sender phone
        <input style={inputStyle} className="mono" value={senderMsisdn} placeholder="07…"
          onChange={(e) => setSenderMsisdn(e.target.value)} />
      </label>
      <label className="sub">Receiver name
        <input style={inputStyle} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
      </label>
      <label className="sub">Receiver phone
        <input style={inputStyle} className="mono" value={receiverMsisdn} placeholder="07…"
          onChange={(e) => setReceiverMsisdn(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8, gridColumn: '1 / -1' }}>
        <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save details'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: 0, gridColumn: '1 / -1' }}>{error}</p>}
    </div>
  );
}
