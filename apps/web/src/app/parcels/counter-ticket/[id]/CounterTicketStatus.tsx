'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import type { CounterTicketView } from '../../counter-ticket-actions';

/** mm:ss for anything under an hour, h:mm past it — a queue wait is
 *  rarely long enough to need a day component, and forcing one on
 *  would make a 4-minute wait read "00:00:04:12" for no reason. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const STATUS_COPY: Record<CounterTicketView['status'], { title: string; body: string; tone: 'wait' | 'go' | 'done' }> = {
  WAITING: {
    title: "You'll be served shortly",
    body: 'A clerk will call your ticket number next. Keep this page open — it updates on its own.',
    tone: 'wait',
  },
  CLAIMED: {
    title: "You're being served now",
    body: 'A clerk has picked up your ticket. Head to the counter if you haven’t already.',
    tone: 'go',
  },
  EXPIRED: {
    title: 'This ticket has expired',
    body: 'It was waiting too long and was cleared. Ask the front desk for a new one.',
    tone: 'done',
  },
  CANCELLED: {
    title: 'This ticket was cancelled',
    body: 'Ask the front desk if you still need to be served.',
    tone: 'done',
  },
};

export function CounterTicketStatus({ initial }: { initial: CounterTicketView }) {
  const [ticket, setTicket] = useState(initial);
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - new Date(initial.createdAt).getTime());
  const createdAtMs = useRef(new Date(initial.createdAt).getTime());

  useEffect(() => {
    const tick = () => setElapsedMs(Date.now() - createdAtMs.current);
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/parcels/counter-tickets/${initial.id}/stream`);
    es.addEventListener('ticket', (ev) => {
      try {
        setTicket(JSON.parse((ev as MessageEvent).data));
      } catch {
        // A malformed frame is skipped, not fatal — the next one (or
        // the timer-driven UI already on screen) carries the state.
      }
    });
    return () => es.close();
  }, [initial.id]);

  const copy = STATUS_COPY[ticket.status];
  const stillWaiting = ticket.status === 'WAITING';

  return (
    <div className="card" style={{ padding: 22, textAlign: 'center' }}>
      <p className="sub" style={{ margin: '0 0 6px', fontSize: '.8rem' }}>Your ticket number</p>
      <p className="mono" style={{ margin: '0 0 18px', fontWeight: 800, fontSize: '1.6rem', letterSpacing: '.04em' }}>
        {ticket.serviceTicketNumber}
      </p>

      {stillWaiting && (
        <p className="mono" style={{ margin: '0 0 18px', fontSize: '1.1rem', color: 'var(--tx-2)' }}>
          Waiting {formatElapsed(elapsedMs)}
        </p>
      )}

      <div
        className="chain"
        style={{
          justifyContent: 'center',
          background: copy.tone === 'go' ? 'var(--green-t, #EAF6EE)' : copy.tone === 'done' ? 'var(--bg-1, rgba(0,0,0,.05))' : 'var(--blue-t, #E8F0FE)',
          border: '1px solid var(--line)', marginBottom: 14,
        }}
      >
        <Icon name={copy.tone === 'go' ? 'check-circle' : copy.tone === 'done' ? 'info' : 'clock'} size={18} />
        <span>
          <strong>{copy.title}.</strong> {copy.body}
        </span>
      </div>

      {stillWaiting && (
        <div className="card" style={{ padding: 16, textAlign: 'left', background: 'var(--paper, #f7f7f5)' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '.9rem' }}>While you wait</p>
          <p className="sub" style={{ margin: '0 0 12px', fontSize: '.85rem' }}>
            Fill in your parcel&apos;s details now so your clerk can pick up right where you left off —
            and double-check what you enter, since that&apos;s what goes on the label.
          </p>
          <Link className="btn btn-o btn-sm" href={`/parcels/send?ticket=${ticket.id}`}>
            Fill in details
          </Link>
        </div>
      )}
    </div>
  );
}
