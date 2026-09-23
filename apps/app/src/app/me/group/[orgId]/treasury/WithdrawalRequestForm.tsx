'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionRequestWithdrawal } from './actions';

export function WithdrawalRequestForm({ orgId, leadMinutes }: { orgId: string; leadMinutes: number }) {
  const [amountKes, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeMsisdn, setPayeeMsisdn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null); setOpensAt(null);
    start(async () => {
      const r = await actionRequestWithdrawal({
        orgId, amountKes, purpose, payeeName, payeeMsisdn: payeeMsisdn || undefined,
      });
      if (r.ok) {
        setAmount(''); setPurpose(''); setPayeeName(''); setPayeeMsisdn('');
        setOpensAt(r.data.standbyOpensAt);
        announce('Withdrawal proposed. Every signer has been notified.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard">
      <h2><Icon name="bank" size={18} />Propose a withdrawal</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        Every signer sees this the moment you send it, and has at least {leadMinutes} active-hours
        minutes to sign before it can go through. One rejection stops it immediately.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="wd-amt">Amount (KES)</label>
        <input className="inp mono" id="wd-amt" inputMode="decimal" value={amountKes}
          onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="wd-purpose">What is this for?</label>
        <input className="inp" id="wd-purpose" value={purpose}
          onChange={(e) => setPurpose(e.target.value)} placeholder="Emergency welfare payout to Wanjiku" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="wd-payee">Who is being paid?</label>
        <input className="inp" id="wd-payee" value={payeeName}
          onChange={(e) => setPayeeName(e.target.value)} placeholder="Full name" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="wd-msisdn">Their phone number (optional)</label>
        <input className="inp" id="wd-msisdn" value={payeeMsisdn}
          onChange={(e) => setPayeeMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      {opensAt && !error && (
        <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: '0 0 12px' }}>
          <Icon name="check" size={14} /> Sent. Earliest it can execute:{' '}
          {new Date(opensAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}.
        </p>
      )}
      <button type="button" className="btn btn-p"
        disabled={pending || !amountKes.trim() || !purpose.trim() || !payeeName.trim()} onClick={submit}>
        {pending ? 'Sending…' : 'Broadcast to signers'}
      </button>
    </div>
  );
}
