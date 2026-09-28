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
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)} style={{ background: '#fff', color: 'var(--navy)', borderColor: '#fff', fontWeight: 700 }}>
        <Icon name="plus" size={15} />Add money
      </button>
    );
  }

  if (sent) {
    return (
      <div style={{ background: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.9)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--green)', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="check" size={14} /></span>
        <p style={{ color: 'var(--navy)', fontSize: '.88rem', margin: 0, fontWeight: 600, lineHeight: 1.4 }}>
          STK prompt sent to {msisdn || 'your phone'} — enter your M-Pesa PIN to complete it. Your balance updates once M-Pesa confirms.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: 'rgba(255,255,255,.96)', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,.0)', boxShadow: '0 8px 24px rgba(10,46,77,.08)', minWidth: 280, maxWidth: 420 }}>
      <p style={{ margin: '0 0 12px', fontWeight: 750, color: 'var(--navy)', fontSize: '.92rem', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="coins" size={16} />Top up from M-Pesa</p>
      <div className="fld" style={{ marginBottom: 10 }}>
        <label className="lab" htmlFor="wt-amt">Amount (KES)</label>
        <input className="inp mono" id="wt-amt" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="500" style={{ background: '#fff' }} />
      </div>
      <div className="fld" style={{ marginBottom: 10 }}>
        <label className="lab" htmlFor="wt-phone">M-Pesa number</label>
        <input className="inp" id="wt-phone" inputMode="tel" value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)} placeholder="07XX XXX XXX" style={{ background: '#fff' }} />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row" style={{ marginTop: 4 }}>
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !amount.trim() || !msisdn.trim()} onClick={submit}>
          {pending ? 'Sending…' : 'Send STK prompt'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </button>
      </div>
      <p className="hint" style={{ margin: '10px 0 0', fontSize: '.78rem' }}>You&apos;ll get an M-Pesa prompt — enter your PIN there. Works even on a KES 1,000 handset.</p>
    </div>
  );
}
