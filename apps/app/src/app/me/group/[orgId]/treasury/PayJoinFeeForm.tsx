'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateJoinFeePayment } from './actions';

export function PayJoinFeeForm({ orgId, joinFeeKes, orgName }: { orgId: string; joinFeeKes: number; orgName: string }) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateJoinFeePayment({ orgId, reference: reference || undefined });
      if (r.ok) {
        setDone(true);
        announce('Join fee declared. Waiting for an officer to confirm it.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard">
      <h2><Icon name="lock" size={18} />Pay your join fee</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        {orgName} charges <strong>KES {joinFeeKes.toLocaleString('en-KE')}</strong> to join. Pay by M-Pesa to
        the treasurer or in cash, then say what you paid below — an officer confirms it and your
        membership activates.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="jf-ref">M-Pesa code or note (optional)</label>
        <input className="inp" id="jf-ref" value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="QGH7…, or 'paid at meeting'" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      {done && !error && (
        <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: '0 0 12px' }}>
          <Icon name="check" size={14} /> Declared — waiting on an officer to confirm.
        </p>
      )}
      <button type="button" className="btn btn-p" disabled={pending || done} onClick={submit}>
        {pending ? 'Sending…' : done ? 'Declared' : 'I have paid'}
      </button>
    </div>
  );
}
