'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { claimCounterTicket, listCounterTicketQueue, type CounterTicketRow } from './actions';

/** Green under 2 minutes, amber under 5, red past that — a queue with
 *  one ticket waiting 8 minutes should look different at a glance from
 *  one where everyone just walked in. */
function toneFor(createdAt: string): 'ok' | 'warn' | 'bad' {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (mins >= 5) return 'bad';
  if (mins >= 2) return 'warn';
  return 'ok';
}

function formatElapsed(createdAt: string, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TONE_STYLE: Record<'ok' | 'warn' | 'bad', React.CSSProperties> = {
  ok: { background: 'var(--green-t, #EAF6EE)', color: 'var(--green, #1a7f37)' },
  warn: { background: 'var(--amber-t, rgba(200,140,0,.1))', color: 'var(--amber, #9a6700)' },
  bad: { background: 'var(--red-t, #FDEDED)', color: 'var(--red, #b42318)' },
};

/**
 * The counter's live queue: every walk-in waiting to be served, oldest
 * on top, with a running wait timer that escalates colour so a
 * neglected ticket is visible without reading numbers.
 *
 * Initial paint from the server; kept current after that by the SSE
 * stream at /api/parcel-org/counter-tickets/stream (a thin proxy over
 * core-go's own, since the session lives in an httpOnly cookie no
 * client-side EventSource could attach itself — see that route's own
 * comment). The stream is deliberately signal-only ("something
 * changed") — every signal just re-runs the same server action this
 * component's initial paint used, so the list can never drift from
 * what GET .../queue would say right now.
 */
export function CounterQueueClient({ initial }: { initial: CounterTicketRow[] }) {
  const [tickets, setTickets] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<CounterTicketRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function refresh() {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        const res = await listCounterTicketQueue();
        if (res.ok) setTickets(res.tickets);
      } finally {
        refreshing.current = false;
      }
    }
    const es = new EventSource('/api/parcel-org/counter-tickets/stream');
    es.addEventListener('queue-changed', () => { void refresh(); });
    return () => es.close();
  }, []);

  async function serve(id: string) {
    setClaimingId(id);
    setError(null);
    const res = await claimCounterTicket(id);
    setClaimingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTickets((prev) => prev.filter((t) => t.id !== id));
    setClaimed(res.ticket);
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Waiting at the counter</h3>
        <span className="sub" style={{ fontSize: '.8rem' }}>
          {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}
        </span>
      </div>

      {claimed && (
        <div className="chain ok" style={{ marginBottom: 12 }}>
          <Icon name="check-circle" size={16} />
          <span>
            Now serving <strong className="mono">{claimed.serviceTicketNumber}</strong> — {claimed.msisdn}.
            {claimed.draftDetails ? ' They left some details below to start from.' : ' Start the booking below.'}
          </span>
          <button className="btn btn-o btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setClaimed(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {claimed?.draftDetails ? (
        <pre className="sub" style={{
          margin: '0 0 14px', padding: 10, background: 'var(--paper, #f7f7f5)',
          borderRadius: 8, fontSize: '.78rem', overflowX: 'auto',
        }}>
          {JSON.stringify(claimed.draftDetails, null, 2)}
        </pre>
      ) : null}

      {error && (
        <p className="sub" style={{ color: 'var(--red, #b42318)', margin: '0 0 10px', fontSize: '.85rem' }}>{error}</p>
      )}

      {tickets.length === 0 ? (
        <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>Nobody waiting right now.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {tickets.map((t) => {
            const tone = toneFor(t.createdAt);
            return (
              <li key={t.id} className="row" style={{
                justifyContent: 'space-between', alignItems: 'center',
                border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px',
              }}>
                <div>
                  <p className="mono" style={{ margin: 0, fontWeight: 700 }}>{t.serviceTicketNumber}</p>
                  <p className="sub" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>{t.msisdn}</p>
                </div>
                <span className="mono" style={{
                  ...TONE_STYLE[tone], borderRadius: 999, padding: '4px 10px', fontSize: '.82rem', fontWeight: 700,
                }}>
                  {formatElapsed(t.createdAt, now)}
                </span>
                <button
                  className="btn btn-p btn-sm"
                  disabled={claimingId === t.id}
                  onClick={() => void serve(t.id)}
                >
                  {claimingId === t.id ? 'Serving…' : 'Serve'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
