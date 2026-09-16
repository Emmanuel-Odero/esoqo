'use client';

import { useState, useTransition } from 'react';
import { Icon, PrintableLabel, PrintStyles } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { receiveWalkInParcel, settleCounterParcel } from '../actions';

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

  // The fare for the box that was just received. Separate state from the
  // receipt itself because they're separate facts on the server too (see
  // settleCounterParcel): custody is recorded the moment the box is in
  // hand, payment when the notes are actually counted.
  const [fare, setFare] = useState('');
  const [settled, setSettled] = useState(false);
  const [fareError, setFareError] = useState<string | null>(null);

  // `reference` may be the tracking code (from the worklist row) or the
  // service ticket number the sender was given at booking (manual
  // entry — pre-intake that's the only reference they have). The server
  // resolves either; res.code is the real one, and it's what the label
  // and the fare step both key off.
  function receive(reference: string) {
    setError(null);
    startTransition(async () => {
      const res = await receiveWalkInParcel(reference);
      if (!res.ok) { setError(res.error); return; }
      setJustReceived(res.code);
      setManualCode('');
      setFare('');
      setSettled(false);
      setFareError(null);
      announce(`${res.code} received`, 'assertive');
    });
  }

  function settle(code: string) {
    const amount = Number(fare);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFareError('Enter the amount the sender paid');
      return;
    }
    setFareError(null);
    startTransition(async () => {
      const res = await settleCounterParcel(code, amount);
      if (!res.ok) { setFareError(res.error); return; }
      setSettled(true);
      announce(`Payment of ${amount} shillings recorded for ${code}`, 'assertive');
    });
  }

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label className="sub" htmlFor="manual-code" style={{ display: 'block', marginBottom: 6 }}>
          Or type/scan the sender&apos;s ticket number
        </label>
        <p className="sub" style={{ margin: '0 0 6px', fontSize: '.8rem' }}>
          A walk-in sender has a TCK- ticket number, not a tracking code — either works here.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input id="manual-code" className="mono" value={manualCode}
            placeholder="TCK-XXXXXX"
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

          {/* Pay-at-counter fare. Nothing priced this box online — the
              sender chose to settle here — so if it isn't recorded at
              this desk it is never recorded anywhere. */}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
            {settled ? (
              <p className="sub" style={{ margin: 0 }}>
                <Icon name="check-circle" size={13} /> Payment recorded.
              </p>
            ) : (
              <>
                <label className="sub" htmlFor="fare" style={{ display: 'block', marginBottom: 6 }}>
                  Amount the sender paid (KES)
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <input id="fare" className="mono" value={fare} inputMode="numeric"
                    placeholder="0"
                    onChange={(e) => setFare(e.target.value.replace(/[^0-9.]/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && settle(justReceived)}
                    style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <button className="btn btn-p btn-sm" disabled={pending || !fare.trim()}
                    onClick={() => settle(justReceived)}>
                    {pending ? 'Recording…' : 'Record payment'}
                  </button>
                </div>
                {fareError && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{fareError}</p>}
              </>
            )}
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
