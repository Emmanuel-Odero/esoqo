'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { actionCreateCounterTicket, type CounterTicketChannel } from '../counter-ticket-actions';

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

/**
 * "Request service" — the only thing a walk-in fills in before a
 * ticket exists. Everything else (item, receiver, destination) can
 * wait until a clerk is actually free to take it down, or be filled in
 * here-and-now while waiting (see the ticket screen's own "while you
 * wait" link) — but the phone number has to exist first, since it's
 * the one thing the ticket itself is keyed on.
 */
export function CounterTicketRequestForm({
  orgId, orgName, channel,
}: { orgId: string; orgName: string; channel: CounterTicketChannel }) {
  const router = useRouter();
  const [msisdn, setMsisdn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="card"
      style={{ padding: 22 }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const ticket = await actionCreateCounterTicket(orgId, msisdn, channel);
            router.push(`/parcels/counter-ticket/${ticket.id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not request a ticket. Try again.');
          }
        });
      }}
    >
      <p className="sub" style={{ margin: '0 0 4px', fontSize: '.85rem' }}>Requesting service at</p>
      <p style={{ margin: '0 0 16px', fontWeight: 700, fontSize: '1.05rem' }}>{orgName}</p>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span className="sub" style={{ display: 'block', marginBottom: 6, fontSize: '.85rem' }}>Your phone number</span>
        <input
          type="tel"
          inputMode="tel"
          required
          placeholder="0712 345 678"
          value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)}
          style={fieldStyle}
        />
      </label>

      {error && (
        <p className="sub" style={{ color: 'var(--red, #b42318)', margin: '0 0 14px', fontSize: '.85rem' }}>{error}</p>
      )}

      <button type="submit" className="btn btn-p" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Requesting…' : 'Request a ticket'}
        <Icon name="arrow-right" size={16} />
      </button>
    </form>
  );
}
