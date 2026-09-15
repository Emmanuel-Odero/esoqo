'use client';
import { useState, useTransition } from 'react';
import { actionVerifyFare } from './verify-actions';

/** Tout verify: type/scan receipt or M-Pesa code. Go owns the 90-min TTL + trip match. */
export function VerifyFareForm({ orgId, tripId }: { orgId: string; tripId?: string }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mcard">
      <h2>Verify fare payment</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem' }}>Receipt QR, fare code, or M-Pesa message code. Valid for 90 minutes.</p>
      <div className="fld"><label className="lab" htmlFor="verify-code">Code</label>
        <input className="inp mono" id="verify-code" value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) start(async () => {
            const r = await actionVerifyFare(orgId, { code: code.trim(), scopeTripId: tripId });
            setResult(r.ok ? JSON.stringify(r.data) : r.error);
          }); }} /></div>
      <button className="btn btn-p btn-block" disabled={pending || !code.trim()} onClick={() => start(async () => {
        const r = await actionVerifyFare(orgId, { code: code.trim(), scopeTripId: tripId });
        setResult(r.ok ? JSON.stringify(r.data) : r.error);
      })}>{pending ? 'Verifying…' : 'Verify'}</button>
      {result && <div className="note" style={{ marginTop: 12 }}><div><p className="mono">{result}</p></div></div>}
    </div>
  );
}
