'use client';
import { useCallback, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { actionCheckParcelStatus, type ParcelStatusView } from '../actions';
import { ParcelScanner } from './ParcelScanner';

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Awaiting payment',
  BOOKED: 'Booked — awaiting collection',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  // A pre-printed label (see dbx.ParcelLabelStock) scanned before it
  // was ever attached to a real booking — never has a route/price, so
  // it gets its own render branch below rather than fitting into the
  // Route/Price/Delivered rows every real status uses.
  LABEL_PRINTED: 'Pre-printed label',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

export function TrackParcelForm() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ParcelStatusView | null | undefined>(undefined);
  const [pending, start] = useTransition();

  // Takes an explicit override so a scan result (which sets `code`
  // and wants to look up in the same breath) isn't racing the state
  // update — `code` in a closure here would still read the pre-scan
  // value until the next render.
  function lookup(override?: string) {
    const value = (override ?? code).trim();
    if (!value) return;
    start(async () => {
      const res = await actionCheckParcelStatus(value.toUpperCase());
      setResult(res);
    });
  }

  const handleScan = useCallback((scanned: string) => {
    setCode(scanned);
    lookup(scanned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <label className="sub" htmlFor="track-code" style={{ display: 'block', marginBottom: 6 }}>Parcel code</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="track-code" className="mono" style={fieldStyle} value={code}
          onChange={(e) => setCode(e.target.value)} placeholder="PKG-XXXXXX"
          onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !code.trim()} onClick={() => lookup()}>
          {pending ? 'Checking…' : 'Track'}
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <ParcelScanner onScan={handleScan} />
      </div>

      {result === null && (
        <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '16px 0 0' }} role="alert">
          <Icon name="alert-circle" size={15} />That code wasn't found — check it and try again.
        </p>
      )}

      {result && result.preLabel && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="sub">Status</span>
            <strong>{STATUS_LABEL.LABEL_PRINTED}</strong>
          </div>
          {result.preLabelInfo ? (
            <>
              <p style={{ margin: '0 0 8px' }}>{result.preLabelInfo.itemDescription}</p>
              <LabelInfoRow label="Destination" value={result.preLabelInfo.destination} />
              <LabelInfoRow label="Owner" value={result.preLabelInfo.ownerName} />
              <LabelInfoRow label="Contact" value={result.preLabelInfo.ownerContact} />
              <LabelInfoRow label="Gender" value={result.preLabelInfo.ownerGender} />
              <LabelInfoRow label="Item type" value={result.preLabelInfo.itemType} />
              <LabelInfoRow label="Weight" value={result.preLabelInfo.weightRangeKg} />
            </>
          ) : (
            <p style={{ margin: 0 }}>This label hasn&apos;t been attached to a shipment yet.</p>
          )}
        </div>
      )}

      {result && !result.preLabel && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="sub">Status</span>
            <strong>{STATUS_LABEL[result.status] ?? result.status}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="sub">Route</span>
            <strong>{result.originLabel} → {result.destinationLabel}</strong>
          </div>
          {result.priceKes && (
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="sub">Price</span>
              <span className="mono">KES {Number(result.priceKes).toLocaleString('en-KE')}</span>
            </div>
          )}
          {result.deliveredAt && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="sub">Delivered</span>
              <span>{new Date(result.deliveredAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabelInfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
      <span className="sub">{label}</span>
      <span>{value}</span>
    </div>
  );
}
