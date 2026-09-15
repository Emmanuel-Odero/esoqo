'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionRetryBookingPayment } from './actions';

export function RetryPaymentButton({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionRetryBookingPayment(bookingId);
      if (r.ok) {
        setSent(true);
        announce(r.data.status === 'PAID' ? 'Payment received.' : 'Check your phone for the M-Pesa prompt.', 'polite');
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  if (sent) return <p style={{ margin: '8px 0 0', fontSize: '.85rem', color: 'var(--green)' }}>
    <Icon name="check" size={14} /> Prompt sent — check your phone.
  </p>;

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={submit}>
        <Icon name="phone-call" size={14} />{pending ? 'Sending…' : 'Retry payment'}
      </button>
      {error && <p className="err" role="alert" style={{ marginTop: 6 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
