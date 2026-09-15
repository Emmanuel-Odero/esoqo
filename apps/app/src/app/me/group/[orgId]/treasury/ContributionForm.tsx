'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionDeclareContribution } from './actions';

export function ContributionForm({ orgId }: { orgId: string }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionDeclareContribution({ orgId, amountKes: amount, reference: reference || undefined });
      if (r.ok) {
        setDone(true); setAmount(''); setReference('');
        announce('Contribution declared. Waiting for an officer to confirm it.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard">
      <h2><Icon name="coins" size={18} />Declare a contribution</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        Say what you paid — in cash at a meeting, or by M-Pesa to the treasurer. An officer confirms
        it before it counts toward the group's balance.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="ct-amt">Amount (KES)</label>
        <input className="inp mono" id="ct-amt" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="500" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="ct-ref">M-Pesa code or note (optional)</label>
        <input className="inp" id="ct-ref" value={reference}
          onChange={(e) => setReference(e.target.value)} placeholder="QGH7…, or 'paid at meeting'" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      {done && !error && (
        <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: '0 0 12px' }}>
          <Icon name="check" size={14} /> Declared — waiting on an officer to confirm.
        </p>
      )}
      <button type="button" className="btn btn-p" disabled={pending || !amount.trim()} onClick={submit}>
        {pending ? 'Sending…' : 'Declare contribution'}
      </button>
    </div>
  );
}
