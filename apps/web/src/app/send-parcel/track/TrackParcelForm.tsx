'use client';
import { useCallback, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionCheckParcelStatus, type ParcelStatusView } from '../actions';
import { ParcelStatusPanel } from '../ParcelStatusPanel';
import { ParcelScanner } from './ParcelScanner';
import { StaffPanel } from './StaffPanel';

// Status wording, the timeline and the result layout all live in
// ParcelStatusPanel/parcel-format now, shared with the /t/<code> page
// every SMS links to. This page used to carry its own STATUS_LABEL map
// and its own row layout, which is exactly how two surfaces end up
// describing the same parcel differently.

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
    <>
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

      {result && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <ParcelStatusPanel parcel={result} />
        </div>
      )}
    </div>
    <StaffPanel />
    </>
  );
}
