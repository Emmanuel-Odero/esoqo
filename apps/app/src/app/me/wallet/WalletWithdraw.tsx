'use client';
import { useState, useTransition, useEffect } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionWithdrawWallet, actionQuoteWithdrawalFee } from './actions';

/** `registeredMsisdn` is shown read-only, never editable — the whole
 *  point of a withdrawal is that it can only ever go to the number the
 *  wallet's owner registered with, and a form field that looked editable
 *  would misrepresent that as a choice the payer has. */
export function WalletWithdraw({ registeredMsisdn, balanceKes }: { registeredMsisdn: string; balanceKes: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ feeKes: number; netPayoutKes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ feeKes: number; netPayoutKes: number } | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  // Debounced live quote — so the fee is known before committing, not a
  // surprise on the confirmation screen after the money has moved.
  useEffect(() => {
    if (!amount.trim() || sent) { setQuote(null); return; }
    const id = setTimeout(() => {
      actionQuoteWithdrawalFee(Number(amount)).then(setQuote).catch(() => setQuote(null));
    }, 350);
    return () => clearTimeout(id);
  }, [amount, sent]);

  function close() {
    setOpen(false); setError(null); setSent(null); setAmount(''); setQuote(null);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionWithdrawWallet({ amountKes: Number(amount) });
      if (r.status === 'STARTED') {
        setSent({ feeKes: r.feeKes, netPayoutKes: r.netPayoutKes });
        announce(
          r.alreadyConfirmed ? 'Withdrawal sent to your M-Pesa.' : 'Withdrawal started — check your phone.',
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
      <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
        <Icon name="download" size={15} />Withdraw
      </button>

      {open && (
        <Modal
          title="Withdraw to M-Pesa"
          onClose={close}
          footer={sent ? (
            <button type="button" className="btn btn-o" onClick={close}>Close</button>
          ) : (
            <>
              <button type="button" className="btn btn-o" disabled={pending} onClick={close}>Cancel</button>
              <button type="button" className="btn btn-p" disabled={pending || !amount.trim()} onClick={submit}>
                {pending ? 'Sending…' : 'Withdraw'}
              </button>
            </>
          )}
        >
          {sent ? (
            <p style={{ color: 'var(--green)', fontSize: '.9rem', margin: 0 }}>
              <Icon name="check" size={14} /> KES {sent.netPayoutKes.toLocaleString('en-KE')} is on its way to {registeredMsisdn}
              {sent.feeKes > 0 ? ` (KES ${sent.feeKes.toLocaleString('en-KE')} withdrawal fee already taken out)` : ''}.
            </p>
          ) : (
            <>
              <p className="hint" style={{ margin: '0 0 10px' }}>
                Always goes to your registered number — <strong className="mono">{registeredMsisdn}</strong>.
                Available: <strong className="mono">KES {balanceKes.toLocaleString('en-KE')}</strong>.
              </p>
              <div className="fld">
                <label className="lab" htmlFor="ww-amt">Amount (KES)</label>
                <input className="inp mono" id="ww-amt" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="500" autoFocus />
              </div>
              {quote && (
                <p className="hint" style={{ margin: '8px 0 0' }}>
                  {quote.feeKes > 0
                    ? <>Fee: <strong className="mono">KES {quote.feeKes.toLocaleString('en-KE')}</strong> — you&apos;ll receive <strong className="mono">KES {quote.netPayoutKes.toLocaleString('en-KE')}</strong>.</>
                    : <>No fee — you&apos;ll receive <strong className="mono">KES {quote.netPayoutKes.toLocaleString('en-KE')}</strong>.</>}
                </p>
              )}
              {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
