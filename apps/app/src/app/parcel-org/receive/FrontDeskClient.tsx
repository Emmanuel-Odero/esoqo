'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, PrintableLabel, PrintStyles } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { extractParcelCode } from '@esoqo/domain';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { receiveWalkInParcel, resolveOrgLabel, settleCounterParcel } from '../actions';
import { ScanButton } from '../ScanButton';

/**
 * The front desk's own worklist plus a manual "type the code" entry —
 * a sender who booked online but whose row hasn't shown up yet (the
 * dashboard poll interval, or a booking made seconds ago) still has a
 * code to hand over, so receiving isn't blocked on this list refreshing
 * first.
 */
export function FrontDeskClient({ waiting, orgName, orgLogoUrl }: { waiting: OrgParcelRow[]; orgName: string; orgLogoUrl?: string }) {
  const [manualCode, setManualCode] = useState('');
  const [justReceived, setJustReceived] = useState<string | null>(null);
  // QR signature for the just-received label, so its reprint stays
  // genuine. Resolved after receipt; absent = still printable, just
  // unverified until re-resolved.
  const [justReceivedSig, setJustReceivedSig] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();
  // Focused on mount so a scanner gun types straight into the box.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

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
      // Camera QRs decode to the tracking URL, guns to the bare code —
      // accept either; the server resolves both.
      const clean = extractParcelCode(reference.trim()) || reference.trim();
      const res = await receiveWalkInParcel(clean);
      if (!res.ok) { setError(res.error); return; }
      setJustReceived(res.code);
      setJustReceivedSig(undefined);
      setManualCode('');
      setFare('');
      setSettled(false);
      setFareError(null);
      announce(`${res.code} received`, 'assertive');
      // Resolve the signature in the background so the reprint below is
      // genuine with company branding (or Esoqo alone when no logo).
      void resolveOrgLabel(res.code).then((r) => {
        if (r.ok && r.label.sig) setJustReceivedSig(r.label.sig);
      });
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
          Or scan / type the sender&apos;s ticket number
        </label>
        <p className="sub" style={{ margin: '0 0 6px', fontSize: '.8rem' }}>
          Camera, scanner gun, or keyboard — a walk-in sender has a TCK- ticket number, not a
          tracking code. Click the box, then scan your gun and press Enter.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input id="manual-code" ref={inputRef} className="mono" value={manualCode}
            placeholder="TCK-XXXXXX — click here, then scan"
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && manualCode.trim() && receive(manualCode.trim())}
            style={{ flex: 1, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
          <button className="btn btn-p btn-sm" disabled={pending || !manualCode.trim()}
            onClick={() => receive(manualCode.trim())}>
            {pending ? 'Receiving…' : 'Confirm receipt'}
          </button>
          <ScanButton onScan={(scanned) => receive(scanned)} />
        </div>
        {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
      </div>

      {justReceived && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>
            {justReceived} received — the sender and receiver have been texted.
          </strong>
          <div className="print-modal-escape">
            <PrintableLabel code={justReceived} sig={justReceivedSig} orgName={orgName} orgLogoUrl={orgLogoUrl} />
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
