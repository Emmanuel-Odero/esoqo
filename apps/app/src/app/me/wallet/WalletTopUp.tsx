'use client';
import { useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
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

  function close() {
    setOpen(false); setError(null); setSent(false); setAmount(''); setMsisdn('');
  }

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

  return (
    <>
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)} style={{ background: '#fff', color: 'var(--navy)', borderColor: '#fff', fontWeight: 700 }}>
        <Icon name="plus" size={15} />Top up
      </button>

      {open && (
        <Modal
          title="Top up from M-Pesa"
          onClose={close}
          footer={sent ? (
            <button type="button" className="btn btn-o" onClick={close}>Close</button>
          ) : (
            <>
              <button type="button" className="btn btn-o" disabled={pending} onClick={close}>Cancel</button>
              <button type="button" className="btn btn-p" disabled={pending || !amount.trim() || !msisdn.trim()} onClick={submit}>
                {pending ? 'Sending…' : 'Send STK prompt'}
              </button>
            </>
          )}
        >
          {sent ? (
            <p style={{ color: 'var(--green)', fontSize: '.9rem', margin: 0 }}>
              <Icon name="check" size={14} /> STK prompt sent to {msisdn || 'your phone'} — enter your M-Pesa PIN to
              complete it. Your balance updates once M-Pesa confirms.
            </p>
          ) : (
            <>
              <div className="fld">
                <label className="lab" htmlFor="wt-amt">Amount (KES)</label>
                <input className="inp mono" id="wt-amt" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="500" autoFocus />
              </div>
              <div className="fld">
                <label className="lab" htmlFor="wt-phone">M-Pesa number</label>
                <input className="inp" id="wt-phone" inputMode="tel" value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
              </div>
              {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
              <p className="hint" style={{ margin: '10px 0 0' }}>You&apos;ll get an M-Pesa prompt — enter your PIN there. Works even on a KES 1,000 handset.</p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
