'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionPaymentStatus, type PaymentStatusView } from '../actions';
import {
  actionParkingCheckIn, actionParkingQuote, actionParkingLot, actionStartParkingPayment,
} from './actions';
import type { ParkingLotView, ParkingSessionView } from '@esoqo/db';

/**
 * The parking screen.
 *
 * Three states in one route, because that is the journey: a car park you
 * are about to enter, a car you have parked, and a ticket you are
 * settling. The ticket is the only credential, so the ticket state is the
 * one that has to be unlosable — it is on screen, copyable, and the same
 * code is in the text that was sent.
 *
 * Notice what is NOT here: an amount field. The price is how long the car
 * sat there, and that is the car park's number, not the driver's. A
 * driver who could type the amount would be able to type KES 1.
 */

type View =
  | { step: 'lot'; lot: ParkingLotView }
  | { step: 'checkin'; lot: ParkingLotView }
  | { step: 'ticket'; session: ParkingSessionView }
  | { step: 'quote'; session: ParkingSessionView; free: boolean }
  | { step: 'paid'; session: ParkingSessionView; receipt: string | null }
  | { step: 'paying'; session: ParkingSessionView; paymentId: string }
  | { step: 'failed'; session: ParkingSessionView; reason: string };

export function ParkingClient({
  initialLotCode,
  initialTicketCode,
}: {
  initialLotCode: string | null;
  initialTicketCode: string | null;
}) {
  const [view, setView] = useState<View | null>(null);
  const [lotError, setLotError] = useState('');
  const [pending, startTransition] = useTransition();

  const run = useCallback((fn: () => Promise<void>) => { startTransition(async () => { await fn(); }); }, []);

  // A scanned lot QR lands here with the code in the path, so the lot is
  // resolved on the client and the driver goes straight to check-in
  // rather than being asked to retype a code their camera just read.
  useEffect(() => {
    if (initialTicketCode) {
      run(async () => {
        const q = await actionParkingQuote(initialTicketCode);
        if (q.status === 'PAID') {
          const s = q.session;
          setView({ step: 'paid', session: s, receipt: s.receiptCode });
        } else if (q.status === 'FREE') {
          setView({ step: 'quote', session: q.session, free: true });
        } else if (q.status === 'QUOTED') {
          setView({ step: 'quote', session: q.session, free: false });
        } else {
          setLotError(q.message);
        }
      });
      return;
    }
    if (!initialLotCode) return;
    run(async () => {
      const found = await actionParkingLot(initialLotCode);
      if (found.status === 'FOUND') setView({ step: 'checkin', lot: found.lot });
      else setLotError(found.status === 'NOT_PAYABLE'
        ? 'That car park is registered but cannot take payments at the moment.'
        : 'We cannot find that car park. Check the code and try again.');
    });
  }, [initialLotCode, initialTicketCode, run]);

  /* ── lot search ────────────────────────────────────────────────────── */
  if (!view) {
    return (
      <>
        <ParkingHead
          icon="key"
          kicker="Parking"
          title="Pay for parking"
          lead="Scan the car park’s code, get a ticket by text, and pay for your stay when you collect your car."
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <LotSearch
              pending={pending}
              error={lotError}
              onSubmit={(code) => run(async () => {
                setLotError('');
                const found = await actionParkingLot(code);
                if (found.status === 'FOUND') { setView({ step: 'checkin', lot: found.lot }); return; }
                setLotError(found.status === 'NOT_PAYABLE'
                  ? 'That car park is registered but cannot take payments at the moment.'
                  : 'We cannot find that car park. Check the code and try again.');
              })}
            />
            <TicketLookup
              pending={pending}
              onFound={(session, free, paid) => {
                if (paid) setView({ step: 'paid', session, receipt: session.receiptCode });
                else setView({ step: 'quote', session, free });
              }}
            />
          </div>
        </section>
      </>
    );
  }

  /* ── check in ──────────────────────────────────────────────────────── */
  if (view.step === 'checkin') {
    const { lot } = view;
    return (
      <>
        <ParkingHead
          icon="key"
          kicker={lot.name}
          title="Park here"
          lead={lot.address ?? `KES ${lot.ratePerHourKes} an hour, first ${lot.graceMinutes} minutes free.`}
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <RateCard lot={lot} />
            <CheckInForm
              pending={pending}
              lotName={lot.name}
              lotCode={lot.code}
              onDone={(session) => setView({ step: 'ticket', session })}
            />
          </div>
        </section>
      </>
    );
  }

  /* ── ticket, just issued ───────────────────────────────────────────── */
  if (view.step === 'ticket') {
    const { session } = view;
    return (
      <>
        <ParkingHead
          icon="check-circle"
          kicker={session.lotName}
          title="You’re parked"
          lead="Keep this ticket. You need it to pay when you come back for your car."
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <TicketCard session={session} emphasised />
            <div className="card" style={{ padding: 20, marginTop: 18 }}>
              <p className="sub" style={{ margin: '0 0 14px', fontSize: '.9rem' }}>
                {session.graceMinutes > 0
                  ? `You have ${session.graceMinutes} minutes free. After that it is KES ${session.ratePerHourKes} an hour.`
                  : `This is KES ${session.ratePerHourKes} an hour from the moment you arrived.`}
              </p>
              <button
                type="button"
                className="btn btn-o btn-block"
                onClick={() => run(async () => {
                  const q = await actionParkingQuote(session.ticketCode);
                  if (q.status === 'PAID') { setView({ step: 'paid', session: q.session, receipt: q.session.receiptCode }); return; }
                  if (q.status === 'FREE' || q.status === 'QUOTED') { setView({ step: 'quote', session: q.session, free: q.status === 'FREE' }); return; }
                  setView({ step: 'failed', session, reason: q.message });
                })}
                disabled={pending}
              >
                <Icon name="clock" size={16} /> I’m leaving now — what do I owe?
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  /* ── quote ─────────────────────────────────────────────────────────── */
  if (view.step === 'quote') {
    const { session, free } = view;
    return (
      <>
        <ParkingHead
          icon="coins"
          kicker={session.lotName}
          title={free ? 'Nothing to pay' : 'Your parking charge'}
          lead={free
            ? 'Your stay was inside the free period, so there is nothing to pay.'
            : 'Check the amount, then authorise on your phone.'}
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <QuoteCard session={session} free={free} />
            {!free && (
              <PayForm
                pending={pending}
                onDone={(paymentId) => setView({ step: 'paying', session, paymentId })}
                start={async (msisdn) => {
                  const r = await actionStartParkingPayment({ ticketCode: session.ticketCode, msisdn });
                  if (r.status === 'ALREADY_PAID') {
                    setView({ step: 'paid', session, receipt: session.receiptCode });
                    return null;
                  }
                  if (r.status === 'FREE') { setView({ step: 'quote', session: r.session, free: true }); return null; }
                  if (r.status === 'STARTED') return r.paymentId;
                  setView({ step: 'failed', session, reason: r.message });
                  return null;
                }}
              />
            )}
          </div>
        </section>
      </>
    );
  }

  /* ── waiting on M-Pesa ─────────────────────────────────────────────── */
  if (view.step === 'paying') {
    return (
      <>
        <ParkingHead
          icon="phone"
          kicker={view.session.lotName}
          title="Check your phone"
          lead="Approve the M-Pesa prompt to pay for your parking."
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <WaitingCard
              paymentId={view.paymentId}
              amountKes={view.session.amountKes ?? 0}
              lotName={view.session.lotName}
              onConfirmed={(status) => setView({
                step: 'paid',
                session: view.session,
                receipt: status.status === 'CONFIRMED' ? status.receiptCode : null,
              })}
              onFailed={(reason) => setView({ step: 'failed', session: view.session, reason })}
            />
          </div>
        </section>
      </>
    );
  }

  /* ── failed ────────────────────────────────────────────────────────── */
  if (view.step === 'failed') {
    return (
      <>
        <ParkingHead
          icon="alert-circle"
          kicker={view.session.lotName}
          title="That payment didn’t go through"
          lead="Nothing has been taken. You can try again with the same ticket."
        />
        <section className="sec">
          <div className="wrap" style={{ maxWidth: 560 }}>
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'var(--red)', fontWeight: 600, margin: '0 0 6px' }}>{view.reason}</p>
              <p className="sub" style={{ margin: '0 0 20px' }}>Ticket {view.session.ticketCode}</p>
              <button
                type="button"
                className="btn btn-p btn-block"
                onClick={() => setView({ step: 'quote', session: view.session, free: view.session.amountKes === 0 })}
              >
                <Icon name="refresh" size={16} /> Try again
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  /* ── paid ──────────────────────────────────────────────────────────── */
  const done = view as Extract<View, { step: 'paid' }>;
  return (
    <>
      <ParkingHead
        icon="check-circle"
        kicker={done.session.lotName}
        title="Parking paid"
        lead="You’re all settled. Collect your car."
      />
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <span className="icbox icbox-g" style={{ width: 52, height: 52, borderRadius: 13, margin: '0 auto 14px' }}>
              <Icon name="check-circle" size={28} />
            </span>
            <h2 style={{ margin: '0 0 4px' }}>KES {done.session.amountKes ?? 0} paid</h2>
            <p className="mono" style={{ fontSize: '.85rem', color: 'var(--tx-2)', margin: '0 0 4px' }}>
              Ticket {done.session.ticketCode}
            </p>
            {done.receipt && (
              <p className="mono" style={{ fontSize: '.82rem', color: 'var(--tx-3)', margin: 0 }}>
                Receipt {done.receipt}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function ParkingHead({ icon, kicker, title, lead }: {
  icon: 'key' | 'check-circle' | 'coins' | 'phone' | 'alert-circle';
  kicker: string; title: string; lead: string;
}) {
  return (
    <section className="phead">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span
          className="icbox"
          style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}
        >
          <Icon name={icon} size={28} />
        </span>
        <p className="kicker" style={{ justifyContent: 'center' }}>{kicker}</p>
        <h1 style={{ margin: '0 auto' }}>{title}</h1>
        <p className="lead" style={{ margin: '12px auto 0', maxWidth: 480 }}>{lead}</p>
      </div>
    </section>
  );
}

function RateCard({ lot }: { lot: ParkingLotView }) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: '1.05rem' }}>KES {lot.ratePerHourKes} an hour</strong>
        <span className="chip">{lot.graceMinutes > 0 ? `${lot.graceMinutes} min free` : 'No free period'}</span>
      </div>
      <p className="sub" style={{ margin: '10px 0 0', fontSize: '.88rem' }}>
        {lot.maxPerDayKes ? `Maximum KES ${lot.maxPerDayKes} a day. ` : ''}
        {lot.address ?? lot.county ?? ''}
      </p>
    </div>
  );
}

function CheckInForm({ pending, lotName, lotCode, onDone }: {
  pending: boolean; lotName: string; lotCode: string;
  onDone: (session: ParkingSessionView) => void;
}) {
  const [msisdn, setMsisdn] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [error, setError] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        void actionParkingCheckIn({ lotCode, msisdn, plateNo }).then((r) => {
          if (r.status === 'CHECKED_IN') onDone(r.session);
          else setError(r.message);
        });
      }}
    >
      <div className="card" style={{ padding: 28 }}>
        <h2 style={{ marginBottom: 6 }}>Park at {lotName}</h2>
        <p className="sub" style={{ marginBottom: 18 }}>We’ll text your ticket to this number.</p>

        <label className="fin-lbl" htmlFor="pk-msisdn">M-Pesa number</label>
        <input
          id="pk-msisdn"
          className="mono"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={msisdn}
          onChange={(e) => { setMsisdn(e.target.value); setError(''); }}
          placeholder="07XX XXX XXX"
          style={inputStyle}
          required
        />

        <label className="fin-lbl" htmlFor="pk-plate" style={{ marginTop: 16, display: 'block' }}>
          Number plate <span style={{ color: 'var(--tx-3)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="pk-plate"
          className="mono"
          type="text"
          value={plateNo}
          onChange={(e) => setPlateNo(e.target.value.toUpperCase())}
          placeholder="KCB 123A"
          style={inputStyle}
        />

        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-p btn-block" style={{ marginTop: 18 }} disabled={pending || !msisdn.trim()}>
          {pending ? <span className="spin" aria-hidden /> : <Icon name="check" size={16} />}
          Park and text my ticket
        </button>
      </div>
    </form>
  );
}

function TicketCard({ session, emphasised }: { session: ParkingSessionView; emphasised?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="card"
      style={{ padding: 28, textAlign: 'center', borderWidth: emphasised ? 2 : 1, borderColor: emphasised ? 'var(--green)' : undefined }}
    >
      <p className="sub" style={{ margin: '0 0 4px', fontSize: '.78rem', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>
        Your ticket
      </p>
      <p
        className="mono"
        data-testid="parking-ticket"
        style={{ fontSize: '1.9rem', fontWeight: 700, letterSpacing: '.06em', margin: '0 0 6px', color: 'var(--navy)' }}
      >
        {session.ticketCode}
      </p>
      <p className="sub" style={{ margin: '0 0 16px', fontSize: '.88rem' }}>
        {session.plateNo ? `${session.plateNo} · ` : ''}at {session.lotName}
      </p>
      <button
        type="button"
        className="btn btn-o btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(session.ticketCode);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        <Icon name={copied ? 'check' : 'link'} size={15} /> {copied ? 'Copied' : 'Copy ticket'}
      </button>
    </div>
  );
}

function QuoteCard({ session, free }: { session: ParkingSessionView; free: boolean }) {
  const hours = session.billedMinutes === null ? 0 : Math.ceil(session.billedMinutes / 60);
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <span className="sub">Car park</span>
        <span style={{ fontWeight: 600 }}>{session.lotName}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <span className="sub">Ticket</span>
        <span className="mono" style={{ fontSize: '.88rem' }}>{session.ticketCode}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
        <span className="sub">Time parked</span>
        <span style={{ fontWeight: 600 }}>{formatDuration(session.billedMinutes)}</span>
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0 0', borderTop: '2px solid var(--navy)' }}
      >
        <strong style={{ fontSize: '1.05rem' }}>To pay</strong>
        <span className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--navy)' }}>
          KES {session.amountKes ?? 0}
        </span>
      </div>
      {!free && session.billedMinutes !== null && hours > 0 && (
        <p className="sub" style={{ margin: '12px 0 0', fontSize: '.84rem' }}>
          {hours} {hours === 1 ? 'hour' : 'hours'} at KES {session.ratePerHourKes}, after{' '}
          {session.graceMinutes} free {session.graceMinutes === 1 ? 'minute' : 'minutes'}.
        </p>
      )}
    </div>
  );
}

function PayForm({ pending, onDone, start }: {
  pending: boolean;
  onDone: (paymentId: string) => void;
  start: (msisdn: string) => Promise<string | null>;
}) {
  const [msisdn, setMsisdn] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const id = await start(msisdn);
        if (id) onDone(id);
      }}
      className="card"
      style={{ padding: 24, marginTop: 18 }}
    >
      <label className="fin-lbl" htmlFor="pk-pay-msisdn">Pay with M-Pesa number</label>
      <input
        id="pk-pay-msisdn"
        className="mono"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={msisdn}
        onChange={(e) => setMsisdn(e.target.value)}
        placeholder="07XX XXX XXX"
        style={inputStyle}
        required
      />
      <button type="submit" className="btn btn-p btn-block" style={{ marginTop: 16 }} disabled={pending || !msisdn.trim()}>
        <Icon name="phone" size={16} /> Pay now
      </button>
      <p className="sub" style={{ margin: '12px 0 0', fontSize: '.84rem', textAlign: 'center' }}>
        You will get an M-Pesa prompt to approve on your phone.
      </p>
    </form>
  );
}

/** Polls the same status action /pay/business uses, because a parking
 *  payment is a BusinessPayment and there is no reason for the two to
 *  disagree about whether money moved. */
function WaitingCard({ paymentId, amountKes, lotName, onConfirmed, onFailed }: {
  paymentId: string; amountKes: number; lotName: string;
  onConfirmed: (status: Extract<PaymentStatusView, { status: 'CONFIRMED' }>) => void;
  onFailed: (reason: string) => void;
}) {
  // The callbacks are new closures on every render, so depending on them
  // would clear and reset the interval each time — and a poll that never
  // survives a re-render is a payment that never appears to complete.
  const latest = useRef({ onConfirmed, onFailed });
  latest.current = { onConfirmed, onFailed };

  useEffect(() => {
    let stopped = false;
    const t = setInterval(async () => {
      const s = await actionPaymentStatus(paymentId);
      if (stopped) return;
      if (s.status === 'CONFIRMED') latest.current.onConfirmed(s);
      else if (s.status === 'FAILED') latest.current.onFailed(s.reason ?? 'The payment was declined.');
    }, 2500);
    return () => { stopped = true; clearInterval(t); };
  }, [paymentId]);

  return (
    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
      <span className="icbox icbox-g" style={{ width: 52, height: 52, borderRadius: 13, margin: '0 auto 14px' }}>
        <Icon name="phone" size={28} />
      </span>
      <h2 style={{ margin: '0 0 6px' }}>KES {amountKes} to {lotName}</h2>
      <p className="sub" style={{ margin: '0 0 18px' }}>Waiting for you to approve the M-Pesa prompt…</p>
      <span className="spin" style={{ display: 'inline-block' }} aria-hidden />
    </div>
  );
}

function LotSearch({ pending, error, onSubmit }: {
  pending: boolean; error: string; onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(code); }}
      style={{ marginBottom: 18 }}
    >
      <div className="card" style={{ padding: 28 }}>
        <h2 style={{ marginBottom: 6 }}>Enter a car park code</h2>
        <p className="sub" style={{ marginBottom: 18 }}>
          It is on the sign at the entrance, and in the QR stuck to the barrier.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="mono"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PRK-4KX9-2J"
            aria-label="Car park code"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            required
          />
          <button type="submit" className="btn btn-p" disabled={pending || !code.trim()}>
            {pending ? <span className="spin" aria-hidden /> : <Icon name="arrow-right" size={16} />}
            {pending ? 'Looking…' : 'Enter'}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
            {error}
          </div>
        )}
      </div>
    </form>
  );
}

/** The way back for a driver who lost the text. A ticket is the only
 *  credential on this flow, so "I didn't get the SMS" has to be a
 *  first-class path rather than a support ticket. */
function TicketLookup({ pending, onFound }: {
  pending: boolean;
  onFound: (session: ParkingSessionView, free: boolean, paid: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        void actionParkingQuote(code).then((q) => {
          if (q.status === 'PAID') { onFound(q.session, false, true); return; }
          if (q.status === 'FREE') { onFound(q.session, true, false); return; }
          if (q.status === 'QUOTED') { onFound(q.session, false, false); return; }
          setError(q.message);
        });
      }}
    >
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ marginBottom: 6, fontSize: '1.02rem' }}>Already have a ticket?</h3>
        <p className="sub" style={{ marginBottom: 16, fontSize: '.9rem' }}>
          Enter it to pay for your stay. It is the code in the text we sent you.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="mono"
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
            placeholder="PRT-7QW2-4X"
            aria-label="Parking ticket code"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            required
          />
          <button type="submit" className="btn btn-o" disabled={pending || !code.trim()} aria-label="Find my ticket">
            {pending ? <span className="spin" aria-hidden /> : <Icon name="arrow-right" size={16} />}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
            {error}
          </div>
        )}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', minHeight: 48,
  border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.02rem',
  background: 'var(--paper)',
};

/** Billed minutes, as something a person can read. Hours and minutes
 *  rather than a count, and a "less than an hour" line rather than
 *  "0 hours" for a stay that has been billed at all. */
function formatDuration(billedMinutes: number | null): string {
  if (billedMinutes === null) return '—';
  if (billedMinutes <= 0) return 'Within the free period';
  if (billedMinutes < 60) return `${billedMinutes} min`;
  const h = Math.floor(billedMinutes / 60);
  const m = billedMinutes % 60;
  return m === 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h}h ${m}m`;
}
