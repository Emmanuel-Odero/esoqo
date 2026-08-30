'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionPayBookingBalance, actionCheckBookingStatus } from '../../[slug]/actions';

/** The amount field + M-Pesa prompt for one balance payment. Console
 *  mode auto-confirms and the page refreshes straight to the new
 *  progress; against real Daraja it polls until the callback lands. */
export function BalancePayForm(
  { bookingId, balanceKes, msisdn, dueStr }:
  { bookingId: string; balanceKes: number; msisdn: string; dueStr: string | null },
) {
  const [amount, setAmount] = useState(String(balanceKes));
  const [stage, setStage] = useState<'form' | 'waiting'>('form');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();

  const amountNum = Math.round(Number(amount) || 0);

  useEffect(() => {
    if (stage !== 'waiting') return;
    const t = setInterval(async () => {
      const res = await actionCheckBookingStatus(bookingId);
      if (res && (res.status === 'PAID' || (res.status === 'PARTIALLY_PAID' && res.amountPaidKes > 0))) {
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [stage, bookingId, router]);

  function pay() {
    setError(null);
    if (amountNum <= 0) { setError('Enter an amount'); return; }
    if (amountNum > balanceKes) { setError(`Only KES ${balanceKes.toLocaleString('en-KE')} is left to pay`); return; }
    start(async () => {
      const r = await actionPayBookingBalance({ bookingId, amountKes: amountNum });
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); return; }
      if (r.data.status === 'PAID' || r.data.balanceKes !== balanceKes) {
        router.refresh();
      } else {
        setStage('waiting');
        announce('Check your phone for the M-Pesa prompt.', 'polite');
      }
    });
  }

  if (stage === 'waiting') {
    return (
      <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
        <Icon name="phone-call" size={16} />
        Enter your M-Pesa PIN on the prompt sent to {msisdn}. This page updates on its own.
      </p>
    );
  }

  return (
    <div>
      <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bal-amt">
        How much do you want to pay now?
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input id="bal-amt" className="mono" inputMode="numeric" style={{
          maxWidth: 160, padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        <button type="button" className="btn btn-o btn-sm" onClick={() => setAmount(String(balanceKes))}>
          Pay it all
        </button>
      </div>
      {dueStr && (
        <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
          Balance of KES {balanceKes.toLocaleString('en-KE')} due by {dueStr}.
        </p>
      )}
      {error && (
        <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 0' }} role="alert">
          <Icon name="alert-circle" size={15} />{error}
        </p>
      )}
      <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 12 }}
        disabled={pending || amountNum <= 0} onClick={pay}>
        {pending ? 'Starting…' : `Pay KES ${amountNum.toLocaleString('en-KE')} with M-Pesa`}
      </button>
    </div>
  );
}
