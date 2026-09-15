'use client';

import { useState, useTransition } from 'react';
import { Icon, PrintableLabel, PrintStyles } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { receiveWalkInParcel } from '../actions';

/**
 * The front desk's own worklist plus a manual "type the code" entry —
 * a sender who booked online but whose row hasn't shown up yet (the
 * dashboard poll interval, or a booking made seconds ago) still has a
 * code to hand over, so receiving isn't blocked on this list refreshing
 * first.
 */
export function FrontDeskClient({ waiting }: { waiting: OrgParcelRow[] }) {
  const [manualCode, setManualCode] = useState('');
  const [justReceived, setJustReceived] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function receive(code: string) {
    setError(null);
    startTransition(async () => {
      const res = await receiveWalkInParcel(code);
      if (!res.ok) { setError(res.error); return; }
      setJustReceived(code);
      setManualCode('');
      announce(`${code} received`, 'assertive');
    });
  }

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label className="sub" htmlFor="manual-code" style={{ display: 'block', marginBottom: 6 }}>
          Or type/scan a code directly
        </label>
        <div className="row" style={{ gap: 8 }}>
          <input id="manual-code" className="mono" value={manualCode}
            placeholder="PKG-XXXXXX"
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && manualCode.trim() && receive(manualCode.trim())}
            style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
          <button className="btn btn-p btn-sm" disabled={pending || !manualCode.trim()}
            onClick={() => receive(manualCode.trim())}>
            {pending ? 'Receiving…' : 'Confirm receipt'}
          </button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
      </div>

      {justReceived && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>
            {justReceived} received — the sender and receiver have been texted.
          </strong>
          <div className="print-modal-escape">
            <PrintableLabel code={justReceived} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-o btn-sm" onClick={() => window.print()}>
              <Icon name="print" size={13} />Print label
            </button>
            <button className="btn btn-o btn-sm" onClick={() => setJustReceived(null)}>Dismiss</button>
          </div>
          <PrintStyles />
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Waiting at your desk ({waiting.length})</strong>
        {waiting.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>Nothing waiting right now.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Code</th><th>Receiver</th><th>Destination</th><th /></tr>
            </thead>
            <tbody>
              {waiting.map((p) => (
                <tr key={p.code}>
                  <td className="mono">{p.code}</td>
                  <td>{p.receiverName}</td>
                  <td>{p.destinationLabel}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-p btn-sm" disabled={pending} onClick={() => receive(p.code)}>
                      Confirm receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
