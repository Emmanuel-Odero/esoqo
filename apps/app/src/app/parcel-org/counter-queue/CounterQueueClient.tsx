'use client';

import { useEffect, useRef, useState } from 'react';
import {
  cancelCounterTicket,
  claimCounterTicket,
  listCounterTicketHistory,
  listCounterTicketQueue,
  type CounterTicketRow,
} from './actions';
import { ServeTicketPanel } from './ServeTicketPanel';

/** Green under 2 minutes, amber under 5, red past that — a queue with
 *  one ticket waiting 8 minutes should look different at a glance from
 *  one where everyone just walked in.
 *
 *  `now` is null until the first client effect runs: the server can't
 *  know the browser's clock, so every elapsed/locale-derived string
 *  below renders a placeholder during SSR and the hydration pass, then
 *  fills in on the first client tick. Without that, `Date.now()` and
 *  `toLocaleString` disagree between the two renders and React throws
 *  a hydration mismatch. */
function toneFor(createdAt: string, nowMs: number | null): 'ok' | 'warn' | 'bad' {
  if (nowMs === null) return 'ok';
  const mins = (nowMs - new Date(createdAt).getTime()) / 60000;
  if (mins >= 5) return 'bad';
  if (mins >= 2) return 'warn';
  return 'ok';
}

function formatElapsed(createdAt: string, nowMs: number | null): string {
  if (nowMs === null) return '—';
  const total = Math.max(0, Math.floor((nowMs - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatWhen(iso: string, nowMs: number | null): string {
  if (nowMs === null) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const TONE_STYLE: Record<'ok' | 'warn' | 'bad', React.CSSProperties> = {
  ok: { background: 'var(--green-t, #EAF6EE)', color: 'var(--green, #1a7f37)' },
  warn: { background: 'var(--amber-t, rgba(200,140,0,.1))', color: 'var(--amber, #9a6700)' },
  bad: { background: 'var(--red-t, #FDEDED)', color: 'var(--red, #b42318)' },
};

function chip(label: string, tone: 'ok' | 'warn' | 'bad', size = '.82rem'): React.CSSProperties {
  return {
    ...TONE_STYLE[tone], borderRadius: 999, padding: '4px 10px',
    fontSize: size, fontWeight: 700, whiteSpace: 'nowrap',
  };
}

/** How far a claimed case has got — what the "In service" row shows
 *  instead of a bare status, so a glance separates "clerk is still
 *  taking details" from "box is waiting for money". */
function stageFor(t: CounterTicketRow): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (t.parcelPaidAt) return { label: 'Completed', tone: 'ok' };
  if (['CANCELLED', 'RETURNED_TO_SENDER', 'DELIVERED'].includes(t.parcelStatus ?? '')) {
    return { label: `Parcel ${t.parcelStatus}`, tone: 'bad' };
  }
  if (!t.parcelCode) return { label: 'Confirming details', tone: 'warn' };
  if (t.parcelStatus === 'BOOKED') return { label: 'Awaiting receipt', tone: 'ok' };
  if (t.paymentPending) return { label: 'Awaiting M-Pesa', tone: 'warn' };
  return { label: 'Awaiting payment', tone: 'warn' };
}

/** The register's chip — a closed case is read by WHY it closed
 *  first, not by its raw enum. */
function closedChip(t: CounterTicketRow): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (t.status === 'CANCELLED') return { label: 'Discarded', tone: 'bad' };
  if (t.status === 'EXPIRED') return { label: 'Expired', tone: 'warn' };
  if (t.parcelPaidAt) return { label: 'Completed', tone: 'ok' };
  return { label: t.status.toLowerCase(), tone: 'ok' };
}

/** "This clerk closed the panel on purpose" — persisted per ticket so
 *  an explicit ✕ stays closed across a refresh, while a plain refresh
 *  (the exact event that used to make the case vanish from every
 *  screen) reopens it exactly where it was left. sessionStorage, not
 *  localStorage: the intent is this shift's, not this browser's. */
function panelClosedKey(ticketId: string): string {
  return `counter:panel-closed:${ticketId}`;
}

/**
 * The counter's board: what's waiting, what the company is already
 * serving, and what happened to every case that is neither.
 *
 * Three lists, one SSE stream. Initial paint from the server; every
 * stream signal re-runs the same server actions that produced that
 * paint, so the board can never drift from what GET .../queue and GET
 * .../history would say right now (see the stream route's own comment
 * on why the events are signal-only).
 *
 * The middle list is the one that used to be missing: a claimed case
 * lived only in this component's `claimed` state, so a refresh — or a
 * stray ✕ — dropped it out of every screen in the product while its
 * row sat safely in the database. Now the server tells us every CLAIMED
 * case the company holds, `mine` lets the clerk who holds one resume
 * it (auto-reopened on mount unless they dismissed it on purpose), and
 * the register below keeps discarded and finished cases readable
 * instead of write-only.
 */
export function CounterQueueClient({
  initial,
  initialActive,
  initialHistory,
}: {
  initial: CounterTicketRow[];
  initialActive: CounterTicketRow[];
  initialHistory: CounterTicketRow[];
}) {
  const [tickets, setTickets] = useState(initial);
  const [active, setActive] = useState(initialActive);
  const [history, setHistory] = useState(initialHistory);
  const [now, setNow] = useState<number | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<CounterTicketRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);
  const autoResumed = useRef(false);

  // Null on the server and on the hydration render, so both paint the
  // same placeholder; the first client tick supplies the real clock.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-resume: on mount, a case this clerk was in the middle of
  // comes back as the serving panel it was before the refresh —
  // unless they closed it deliberately, which is what the per-ticket
  // sessionStorage flag records. Mount-only: later stream updates must
  // not yank the panel open over whatever the clerk is doing.
  useEffect(() => {
    if (autoResumed.current) return;
    autoResumed.current = true;
    const mine = initialActive.find((t) => t.mine);
    if (mine && window.sessionStorage.getItem(panelClosedKey(mine.id)) !== '1') {
      setClaimed(mine);
    }
  }, [initialActive]);

  /** Re-fetch both lists from the two actions that produced the
   *  initial paint — the only refresh path there is: the SSE stream
   *  never pushes rows, it just says "go look again", so the board can
   *  never drift from what the server would say. Guarded so a stream
   *  signal arriving mid-refresh is a no-op rather than a second
   *  round-trip racing the first. */
  async function refreshNow() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [queue, register] = await Promise.all([
        listCounterTicketQueue(),
        listCounterTicketHistory(),
      ]);
      if (queue.ok) {
        setTickets(queue.tickets);
        setActive(queue.active);
      }
      if (register.ok) setHistory(register.tickets);
    } finally {
      refreshing.current = false;
    }
  }

  useEffect(() => {
    const es = new EventSource('/api/parcel-org/counter-tickets/stream');
    es.addEventListener('queue-changed', () => { void refreshNow(); });
    return () => es.close();
    // Mount-only subscription: refreshNow closes over only setState
    // fns and the refreshing ref, so re-subscribing per render would
    // buy nothing but dropped events mid-handshake.
  }, []);

  async function serve(id: string) {
    setClaimingId(id);
    setError(null);
    const res = await claimCounterTicket(id);
    setClaimingId(null);
    if (!res.ok) {
      setError(res.error);
      void refreshNow();
      return;
    }
    // `mine: true` because the claim just succeeded under this
    // session — the claim response carries the staff id but the client
    // has no way to compare it against itself.
    const ticket = { ...res.ticket, mine: true };
    setTickets((prev) => prev.filter((t) => t.id !== id));
    setActive((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, ticket]));
    window.sessionStorage.removeItem(panelClosedKey(id));
    setClaimed(ticket);
  }

  /** A sender who never showed — discarded straight from the queue,
   *  no reason prompt: this is the fast, common case, not the "walked
   *  away mid-service" one ServeTicketPanel's own discard handles. */
  async function discard(id: string) {
    setDiscardingId(id);
    setError(null);
    const res = await cancelCounterTicket(id);
    setDiscardingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTickets((prev) => prev.filter((t) => t.id !== id));
    setActive((prev) => prev.filter((t) => t.id !== id));
    window.sessionStorage.removeItem(panelClosedKey(id));
  }

  /** The panel's ✕ — dismiss, don't finish: the case stays CLAIMED
   *  and keeps its place in "In service", and the flag stops the next
   *  refresh from reopening a panel the clerk chose to put away. */
  function dismissPanel() {
    if (!claimed) return;
    window.sessionStorage.setItem(panelClosedKey(claimed.id), '1');
    setClaimed(null);
  }

  /** Terminal close — discarded, handed back, or settled. The case is
   *  no longer in service, so the "don't reopen" flag goes too. */
  function finishPanel() {
    if (claimed) window.sessionStorage.removeItem(panelClosedKey(claimed.id));
    setClaimed(null);
  }

  /** Hand-back succeeded: the ticket is WAITING again, so move it out
   *  of the board's middle list and back into the queue it came from.
   *  The SSE event that follows re-fetches both lists anyway — this is
   *  only the instant version of the same truth. */
  function releasedPanel(ticket: CounterTicketRow) {
    window.sessionStorage.removeItem(panelClosedKey(ticket.id));
    setClaimed(null);
    setActive((prev) => prev.filter((t) => t.id !== ticket.id));
    setTickets((prev) =>
      prev.some((t) => t.id === ticket.id)
        ? prev
        : [...prev, { ...ticket, status: 'WAITING' as const }].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          ),
    );
  }

  const inService = active.filter((t) => t.id !== claimed?.id);

  return (
    <>
      <div className="card" style={{ padding: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>At the counter</h3>
          <span className="sub" style={{ fontSize: '.8rem' }}>
            {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}
            {active.length > 0 && (
              <> · {active.length} in service</>
            )}
          </span>
        </div>

        {claimed && (
          <ServeTicketPanel
            ticket={claimed}
            onDismiss={dismissPanel}
            onDone={finishPanel}
            onReleased={releasedPanel}
          />
        )}

        {error && (
          <p className="sub" style={{ color: 'var(--red, #b42318)', margin: '0 0 10px', fontSize: '.85rem' }}>{error}</p>
        )}

        {inService.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <span className="sub" style={{ fontSize: '.8rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              In service — claimed by your team, nothing here is lost
            </span>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {inService.map((t) => {
                const stage = stageFor(t);
                return (
                  <li key={t.id} className="row" style={{
                    justifyContent: 'space-between', alignItems: 'center',
                    border: '1px dashed var(--line)', borderRadius: 8, padding: '10px 12px',
                  }}>
                    <div>
                      <p className="mono" style={{ margin: 0, fontWeight: 700 }}>{t.serviceTicketNumber}</p>
                      <p className="sub" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>
                        {t.msisdn} · {t.mine ? 'you' : (t.claimedByName ?? 'a colleague')} · serving{' '}
                        {t.claimedAt ? formatElapsed(t.claimedAt, now) : '—'}
                      </p>
                    </div>
                    <span style={chip(stage.label, stage.tone)}>{stage.label}</span>
                    <div className="row" style={{ gap: 6 }}>
                      {t.mine && (
                        <button
                          className="btn btn-p btn-sm"
                          onClick={() => {
                            window.sessionStorage.removeItem(panelClosedKey(t.id));
                            setClaimed(t);
                          }}
                        >
                          Resume
                        </button>
                      )}
                      {/* Once a parcel exists, the ticket's own job is done —
                       *  it's a label/payment case now, not a counter queue
                       *  item, and the backend itself refuses to discard a
                       *  ticket with a parcelId (see dbx.CancelCounterTicket).
                       *  Only a case still "Confirming details" (no parcel
                       *  booked yet) can still be walked away from. */}
                      {!t.parcelCode && (
                        <button
                          className="btn btn-o btn-sm"
                          disabled={discardingId === t.id}
                          onClick={() => void discard(t.id)}
                          title="Discard this case — it never became a parcel"
                        >
                          {discardingId === t.id ? 'Discarding…' : 'Discard'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {tickets.length === 0 ? (
          <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>Nobody waiting right now.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {tickets.map((t) => {
              const tone = toneFor(t.createdAt, now);
              return (
                <li key={t.id} className="row" style={{
                  justifyContent: 'space-between', alignItems: 'center',
                  border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px',
                }}>
                  <div>
                    <p className="mono" style={{ margin: 0, fontWeight: 700 }}>{t.serviceTicketNumber}</p>
                    <p className="sub" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>{t.msisdn}</p>
                  </div>
                  <span className="mono" style={chip(formatElapsed(t.createdAt, now), tone)}>
                    {formatElapsed(t.createdAt, now)}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn btn-o btn-sm"
                      disabled={claimingId === t.id || discardingId === t.id}
                      onClick={() => void discard(t.id)}
                      title="Discard this ticket — the sender never showed"
                    >
                      {discardingId === t.id ? 'Discarding…' : 'Discard'}
                    </button>
                    <button
                      className="btn btn-p btn-sm"
                      disabled={claimingId === t.id || discardingId === t.id}
                      onClick={() => void serve(t.id)}
                    >
                      {claimingId === t.id ? 'Serving…' : 'Serve'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* The register: every closed case, kept where the desk can read
          it. Discards used to be a status update nothing ever showed —
          the row survived in the database while vanishing from the
          product — so this list is the record of them, alongside
          finished bookings and aged-out tickets. */}
      <details className="card" style={{ padding: 18, marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.95rem' }}>
          Ticket register — discarded, unfinished and completed cases ({history.length})
        </summary>
        {history.length === 0 ? (
          <p className="sub" style={{ margin: '10px 0 0', fontSize: '.88rem' }}>
            Nothing has been closed at this counter yet.
          </p>
        ) : (
          <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
            {history.map((t) => {
              const state = closedChip(t);
              return (
                <li key={t.id} className="row" style={{
                  justifyContent: 'space-between', alignItems: 'center',
                  border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px',
                }}>
                  <div>
                    <p className="mono" style={{ margin: 0, fontWeight: 700 }}>{t.serviceTicketNumber}</p>
                    <p className="sub" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>
                      {t.msisdn}
                      {t.cancelReason ? ` · “${t.cancelReason}”` : ''}
                      {t.status === 'CANCELLED' && (
                        <> · by {t.cancelledByStaffName ?? 'staff'}{t.cancelledAt ? ` · ${formatWhen(t.cancelledAt, now)}` : ''}</>
                      )}
                      {t.parcelCode && t.parcelPaidAt && <> · {t.parcelCode}</>}
                      {t.claimedByName && !t.parcelCode && <> · served by {t.claimedByName}</>}
                    </p>
                  </div>
                  <span style={chip(state.label, state.tone)}>{state.label}</span>
                  <span className="sub" style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                    {formatWhen(t.createdAt, now)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </details>
    </>
  );
}
