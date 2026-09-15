'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionPayBookingBalance } from './actions';

/** Amount field + M-Pesa prompt for one balance top-up on a "lipia
 *  pole pole" plan, shown on My tickets next to a part-paid booking. */
export function PayBalanceButton({ bookingId, balanceKes }: { bookingId: string; balanceKes: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balanceKes));
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const amountNum = Math.round(Number(amount) || 0);

  function submit() {
    setError(null);
    if (amountNum <= 0 || amountNum > balanceKes) {
      setError(`Enter an amount up to KES ${balanceKes.toLocaleString('en-KE')}`); return;
    }
    start(async () => {
      const r = await actionPayBookingBalance(bookingId, amountNum);
      if (r.ok) {
        setSent(true);
        announce(r.data.status === 'CONFIRMED' ? 'Payment received.' : 'Check your phone for the M-Pesa prompt.', 'polite');
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  if (sent) return <p style={{ margin: '8px 0 0', fontSize: '.85rem', color: 'var(--green)' }}>
    <Icon name="check" size={14} /> Prompt sent — check your phone. Reload once you've paid.
  </p>;

  if (!open) return (
    <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
      <Icon name="phone-call" size={14} />Pay balance
    </button>
  );

  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="mono" inputMode="numeric" aria-label="Amount to pay" style={{
          maxWidth: 140, padding: '8px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.9rem',
        }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={submit}>
          {pending ? 'Sending…' : `Pay KES ${amountNum.toLocaleString('en-KE')}`}
        </button>
      </div>
      {error && <p className="err" role="alert" style={{ marginTop: 6 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
