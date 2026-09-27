'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionTopUpWallet } from './actions';

export function WalletTopUp() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionTopUpWallet({ amountKes: Number(amount), msisdn });
      if (r.status === 'STARTED') {
        setSent(true);
        announce(
          r.alreadyConfirmed ? 'Wallet topped up.' : 'STK prompt sent — enter your M-Pesa PIN.',
          'polite',
        );
      } else {
        setError(r.message);
        announce(r.message, 'assertive');
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} />Add money
      </button>
    );
  }

  if (sent) {
    return (
      <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: 0 }}>
        <Icon name="check" size={14} /> STK prompt sent to {msisdn || 'your phone'} — enter your PIN
        to complete it. Your balance updates once M-Pesa confirms.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div className="fld">
        <label className="lab" htmlFor="wt-amt">Amount (KES)</label>
        <input className="inp mono" id="wt-amt" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="500" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="wt-phone">M-Pesa number</label>
        <input className="inp" id="wt-phone" inputMode="tel" value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !amount.trim() || !msisdn.trim()} onClick={submit}>
          {pending ? 'Sending…' : 'Send STK prompt'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
