'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { actionCheckParcelStatus, type ParcelStatusView } from '../actions';

const STATUS_LABEL: Record<string, string> = {
  DRAFT_PENDING_PAYMENT: 'Awaiting payment',
  BOOKED: 'Booked — awaiting collection',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

export function TrackParcelForm() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ParcelStatusView | null | undefined>(undefined);
  const [pending, start] = useTransition();

  function lookup() {
    if (!code.trim()) return;
    start(async () => {
      const res = await actionCheckParcelStatus(code.trim().toUpperCase());
      setResult(res);
    });
  }

  return (
    <div className="card">
      <label className="sub" htmlFor="track-code" style={{ display: 'block', marginBottom: 6 }}>Parcel code</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="track-code" className="mono" style={fieldStyle} value={code}
          onChange={(e) => setCode(e.target.value)} placeholder="PKG-XXXXXX"
          onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !code.trim()} onClick={lookup}>
          {pending ? 'Checking…' : 'Track'}
        </button>
      </div>

      {result === null && (
        <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '16px 0 0' }} role="alert">
          <Icon name="alert-circle" size={15} />That code wasn't found — check it and try again.
        </p>
      )}

      {result && (
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
