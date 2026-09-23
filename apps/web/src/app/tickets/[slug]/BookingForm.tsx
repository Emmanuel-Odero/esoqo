'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { columnsForPattern, minDepositKes, INSTALLMENT_MIN_LEAD_HOURS } from '@esoqo/domain';
import { actionCreateBooking, actionListAvailableSeats, actionListScheduleSeats, actionCheckBookingStatus } from './actions';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

const AMENITY_BADGES: Record<string, string> = {
  WIFI: '📶 WiFi', SNACKS: '🍪 Snacks', CHARGING: '🔌 Charging', RECLINING: '🛋️ Reclining',
  EXTRA_LEGROOM: '🦵 Extra legroom', BLANKET: '🧣 Blanket',
};

/** Same soft colour set as the organiser's seat-map builder, so a
 *  buyer sees the identical class-to-colour mapping the organiser
 *  painted with. */
const CLASS_COLOURS = ['#dbe9ff', '#ffe4c2', '#d6f5df', '#f6d6e8', '#e6dbff', '#fff3b0'];

interface TicketClass {
  id: string; name: string; priceKes: number; seated: boolean; capacity: number;
  amenities?: string[]; amenityNote?: string | null;
}
interface Schedule { id: string; departAt: string; vehicleOrHallLabel?: string | null; gateInfo?: string | null }
interface SeatMap { rows: number; pattern: string; seats: { label: string; ticketClassId: string }[] }

export function BookingForm(
  { schedules, ticketClasses, seatMap, signedIn, buyerName, buyerMsisdn, signinUrl,
    installmentsEnabled = false, minDepositPercent = 20 }:
  {
    schedules: Schedule[]; ticketClasses: TicketClass[]; seatMap: SeatMap | null; signedIn: boolean;
    buyerName: string; buyerMsisdn: string; signinUrl: string;
    installmentsEnabled?: boolean; minDepositPercent?: number;
  },
) {
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [seatOptions, setSeatOptions] = useState<Record<string, { id: string; label: string }[]>>({});
  // Only populated when the listing has a saved seat map — every seat
  // for the selected schedule, available and taken alike, so the grid
  // below can grey out what's already booked instead of just omitting it.
  const [scheduleSeats, setScheduleSeats] = useState<{ id: string; label: string; status: string; ticketClassId: string }[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<Record<string, string[]>>({});
  // Guest fields — a signed-in subject's name/phone come pre-filled and
  // read-only from their record; a guest fills these in here instead.
  // Email is optional either way: contact info for ticket delivery and
  // loyalty points, not a login identifier.
  const [name, setName] = useState(buyerName);
  const [msisdn, setMsisdn] = useState(buyerMsisdn);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<'form' | 'waiting' | 'success'>('form');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  // "Lipia pole pole" — pay a deposit now, the balance in M-Pesa
  // top-ups before the trip. Only offered on future-dated,
  // general-admission trips when the organiser has opted in.
  const [plan, setPlan] = useState<'FULL' | 'INSTALLMENT'>('FULL');
  const [deposit, setDeposit] = useState('');
  const [installmentDone, setInstallmentDone] = useState<{ balanceKes: number; balanceDueBy: string } | null>(null);
  const announce = useAnnounce();

  // Poll while a real Daraja callback is in flight — console mode never
  // reaches 'waiting' at all, since the push auto-confirms before
  // actionCreateBooking returns. Same shape as apps/store's checkout.
  useEffect(() => {
    if (stage !== 'waiting' || !bookingId) return;
    const t = setInterval(async () => {
      const res = await actionCheckBookingStatus(bookingId);
      if (res?.status === 'PAID') { setPoints(res.points); setStage('success'); announce('Payment received.', 'polite'); }
      else if (res?.status === 'PARTIALLY_PAID' && res.isInstallment) {
        setInstallmentDone({
          balanceKes: res.balanceKes,
          balanceDueBy: res.balanceDueBy ? new Date(res.balanceDueBy).toISOString() : '',
        });
        setStage('success'); announce('Deposit received.', 'polite');
      }
    }, 4000);
    return () => clearInterval(t);
  }, [stage, bookingId, announce]);

  const seatedClasses = ticketClasses.filter((c) => c.seated);
  const selectedSchedule = schedules.find((s) => s.id === scheduleId);

  useEffect(() => {
    if (!scheduleId) return;
    setSelectedSeats({});
    if (seatMap) {
      // One call gets every seat (available + booked) for the whole
      // schedule — the grid below renders straight from this, matched
      // by label against seatMap.seats for row/column position.
      actionListScheduleSeats(scheduleId).then(setScheduleSeats);
    } else {
      // No seat map saved for this listing — same per-class flat list
      // as before the seat-map builder existed.
      for (const c of seatedClasses) {
        actionListAvailableSeats(scheduleId, c.id).then((seats) =>
          setSeatOptions((prev) => ({ ...prev, [c.id]: seats })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId, seatMap]);

  const totalKes = useMemo(() => {
    let sum = 0;
    for (const c of ticketClasses) {
      if (c.seated) sum += (selectedSeats[c.id]?.length ?? 0) * c.priceKes;
      else sum += (quantities[c.id] ?? 0) * c.priceKes;
    }
    return sum;
  }, [quantities, selectedSeats, ticketClasses]);

  const hasSeatedInCart = seatedClasses.some((c) => (selectedSeats[c.id]?.length ?? 0) > 0);
  const leadOk = selectedSchedule
    ? new Date(selectedSchedule.departAt).getTime() - Date.now() >= INSTALLMENT_MIN_LEAD_HOURS * 3600_000
    : false;
  const installmentEligible = installmentsEnabled && leadOk && !hasSeatedInCart && totalKes > 0;
  const minDep = installmentEligible ? minDepositKes(totalKes, minDepositPercent) : 0;
  const usingInstallment = installmentEligible && plan === 'INSTALLMENT';
  const depositNum = Math.round(Number(deposit) || 0);

  function toggleSeat(classId: string, seatId: string) {
    setSelectedSeats((prev) => {
      const cur = prev[classId] ?? [];
      const next = cur.includes(seatId) ? cur.filter((s) => s !== seatId) : [...cur, seatId];
      return { ...prev, [classId]: next };
    });
  }

  function submit() {
    setError(null);
    if (!name.trim()) { setError('Enter your name'); return; }
    if (!msisdn.trim()) { setError('Enter your phone number'); return; }
    const lines = ticketClasses.flatMap((c) => {
      if (c.seated) return (selectedSeats[c.id] ?? []).map((seatId) => ({ ticketClassId: c.id, seatId }));
      const qty = quantities[c.id] ?? 0;
      return Array.from({ length: qty }, () => ({ ticketClassId: c.id }));
    });
    if (lines.length === 0) { setError('Pick at least one ticket'); return; }
    if (usingInstallment && depositNum < minDep) {
      setError(`The deposit must be at least KES ${minDep.toLocaleString('en-KE')}`); return;
    }

    start(async () => {
      const r = await actionCreateBooking({
        scheduleId, buyerName: name, buyerMsisdn: msisdn, buyerEmail: email || undefined, paymentMethod: 'MPESA_STK', lines,
        ...(usingInstallment ? { payment: { plan: 'INSTALLMENT' as const, depositKes: depositNum } } : {}),
      });
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); return; }

      setBookingId(r.data.bookingId);
      setPoints(r.data.points ?? null);
      if ('isInstallment' in r.data && r.data.isInstallment) {
        setInstallmentDone({ balanceKes: r.data.balanceKes ?? 0, balanceDueBy: r.data.balanceDueBy });
      }
      if (r.data.status === 'PAID') {
        setStage('success');
        announce('Payment received.', 'polite');
      } else if ('isInstallment' in r.data && r.data.isInstallment && r.data.status === 'PARTIALLY_PAID') {
        setStage('success');
        announce('Deposit received.', 'polite');
        if ('warning' in r && r.warning) { setError(r.warning); announce(r.warning, 'assertive'); }
      } else {
        setStage('waiting');
        announce('Check your phone for the M-Pesa prompt.', 'polite');
        if ('warning' in r && r.warning) { setError(r.warning); announce(r.warning, 'assertive'); }
      }
    });
  }

  if (stage === 'success' && installmentDone && installmentDone.balanceKes > 0) {
    const dueStr = installmentDone.balanceDueBy
      ? new Date(installmentDone.balanceDueBy).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })
      : 'the trip';
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Deposit received</h3>
        <p className="sub" style={{ margin: '0 0 8px' }}>
          KES {installmentDone.balanceKes.toLocaleString('en-KE')} left — pay it any time, in any amount,
          before {dueStr}. Your ticket is issued once the balance is cleared.
        </p>
        <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
          We've texted {msisdn} the payment link. Bookmark it:
        </p>
        {bookingId && (
          <a href={`/tickets/booking/${bookingId}`} className="btn btn-p" style={{ marginBottom: 12 }}>
            Pay the balance
          </a>
        )}
        {error && <p style={{ color: 'var(--red)', fontSize: '.85rem' }} role="alert">{error}</p>}
        {!signedIn && (
          <p className="sub" style={{ margin: 0, fontSize: '.8rem' }}>
            <a href={signinUrl}>Sign in</a> to track this from "My tickets".
          </p>
        )}
      </div>
    );
  }

  if (stage === 'success') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Booked</h3>
        <p className="sub" style={{ margin: '0 0 16px' }}>
          Your ticket and its QR code are ready — sent to {msisdn}{email ? ` and ${email}` : ''}.
        </p>
        {points !== null && points > 0 && (
          <p className="sub" style={{ margin: '0 0 16px', fontWeight: 600 }}>You earned {points} loyalty points.</p>
        )}
        {signedIn
          ? <a href={`${APP_URL}/me/tickets`} className="btn btn-p">View your tickets</a>
          : <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>
              <a href={signinUrl}>Sign in</a> to keep this ticket in "My tickets" next time.
            </p>}
      </div>
    );
  }

  if (stage === 'waiting') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="phone-call" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Check your phone</h3>
        <p className="sub" style={{ margin: '0 0 16px' }}>
          Enter your M-Pesa PIN on the prompt sent to {msisdn}. This updates on its own once
          payment is received — no need to reload.
        </p>
        {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }} role="alert">
          <Icon name="alert-circle" size={15} />{error}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 9 }}><Icon name="qr" size={18} />Book</h3>

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bk-sched">When</label>
        <select className="chip" style={{ minHeight: 44, width: '100%' }} id="bk-sched"
          value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.departAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
            </option>
          ))}
        </select>
      </div>

      {(selectedSchedule?.vehicleOrHallLabel || selectedSchedule?.gateInfo) && (
        <div className="sub" style={{ margin: '-8px 0 16px', fontSize: '.85rem', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {selectedSchedule.vehicleOrHallLabel && <span><Icon name="truck" size={13} /> {selectedSchedule.vehicleOrHallLabel}</span>}
          {selectedSchedule.gateInfo && <span><Icon name="pin" size={13} /> {selectedSchedule.gateInfo}</span>}
        </div>
      )}

      {!signedIn && (
        <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
          Booking as a guest — your ticket goes to the phone number below.{' '}
          <a href={signinUrl}>Sign in</a> instead to keep it in "My tickets".
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bk-name">Name</label>
        <input id="bk-name" className="mono" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={name} onChange={(e) => setName(e.target.value)} readOnly={signedIn} placeholder="e.g. Wanjiku" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bk-phone">Phone number</label>
        <input id="bk-phone" className="mono" inputMode="tel" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={msisdn} onChange={(e) => setMsisdn(e.target.value)} readOnly={signedIn} placeholder="07XX XXX XXX" />
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>The M-Pesa prompt and your ticket go here.</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bk-email">Email (optional)</label>
        <input id="bk-email" type="email" className="mono" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>We'll also send your ticket here, and use it for loyalty points.</p>
      </div>

      {seatMap && seatedClasses.length > 0 && (
        <SeatMapPicker
          seatMap={seatMap} seatedClasses={seatedClasses} scheduleSeats={scheduleSeats}
          selectedSeats={selectedSeats} onToggle={toggleSeat}
        />
      )}

      {ticketClasses.map((c) => {
        // Seated classes render inside the visual grid above once a
        // seat map exists — this loop only still handles them when
        // there's no map to draw from (old flat button-list fallback).
        if (c.seated && seatMap) return null;
        return (
          <div style={{ marginBottom: 16 }} key={c.id}>
            <label className="sub" style={{ display: 'block', marginBottom: 6 }}>
              {c.name} — KES {c.priceKes.toLocaleString('en-KE')}{c.seated ? ' / seat' : ''}
            </label>
            {((c.amenities?.length ?? 0) > 0 || c.amenityNote) && (
              <p className="sub" style={{ margin: '0 0 8px', fontSize: '.8rem' }}>
                {(c.amenities ?? []).map((a) => AMENITY_BADGES[a] ?? a).join('  ')}
                {c.amenityNote ? `  +${c.amenityNote}` : ''}
              </p>
            )}
            {c.seated ? (
              <div className="row">
                {(seatOptions[c.id] ?? []).length === 0
                  ? <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>No seats available for this occurrence.</p>
                  : (seatOptions[c.id] ?? []).map((seat) => (
                    <button key={seat.id} type="button"
                      className={`btn btn-sm ${selectedSeats[c.id]?.includes(seat.id) ? 'btn-p' : 'btn-o'}`}
                      onClick={() => toggleSeat(c.id, seat.id)}>
                      {seat.label}
                    </button>
                  ))}
              </div>
            ) : (
              <input className="mono" inputMode="numeric" style={{
                maxWidth: 120, padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
              }}
                value={quantities[c.id] ?? ''}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [c.id]: Math.max(0, Number(e.target.value) || 0) }))}
                placeholder="0" />
            )}
          </div>
        );
      })}

      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)', marginBottom: 16 }}>
        <span className="sub">Total</span><span className="mono" style={{ fontWeight: 700 }}>KES {totalKes.toLocaleString('en-KE')}</span>
      </div>

      {installmentEligible && (
        <div style={{ marginBottom: 16, border: '1.5px solid var(--line)', borderRadius: 10, padding: 12 }}>
          <label className="sub" htmlFor="pay-plan-full" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: usingInstallment ? 10 : 8 }}>
            <input id="pay-plan-full" type="radio" name="pay-plan" checked={plan === 'FULL'} onChange={() => setPlan('FULL')} style={{ marginTop: 3 }} />
            <span>Pay in full now · <span className="mono">KES {totalKes.toLocaleString('en-KE')}</span></span>
          </label>
          <label className="sub" htmlFor="pay-plan-inst" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <input id="pay-plan-inst" type="radio" name="pay-plan" checked={plan === 'INSTALLMENT'} onChange={() => setPlan('INSTALLMENT')} style={{ marginTop: 3 }} />
            <span><strong>Lipia pole pole</strong> — pay a deposit now, the rest before you travel.</span>
          </label>
          {usingInstallment && (
            <div style={{ marginTop: 12 }}>
              <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="bk-deposit">
                Deposit now (min KES {minDep.toLocaleString('en-KE')})
              </label>
              <input id="bk-deposit" className="mono" inputMode="numeric" style={{
                maxWidth: 160, padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
              }} value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^\d]/g, ''))}
                placeholder={String(minDep)} />
              <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
                Balance <span className="mono">KES {Math.max(0, totalKes - depositNum).toLocaleString('en-KE')}</span>
                {selectedSchedule ? ` due by ${new Date(selectedSchedule.departAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}` : ''}.
                {' '}Your ticket is issued once it's fully paid.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }} role="alert">
        <Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending || totalKes <= 0} onClick={submit}>
        {pending
          ? 'Booking…'
          : usingInstallment
            ? `Pay deposit · KES ${(depositNum || minDep).toLocaleString('en-KE')}`
            : `Book · KES ${totalKes.toLocaleString('en-KE')}`}
      </button>
      <p className="sub" style={{ margin: '10px 0 0', fontSize: '.8rem' }}>
        You'll get an M-Pesa prompt to pay once the booking is created.
      </p>
    </div>
  );
}

interface TicketClassOption {
  id: string; name: string; priceKes: number;
  amenities?: string[]; amenityNote?: string | null;
}
interface ScheduleSeat { id: string; label: string; status: string; ticketClassId: string }

/** The actual bus/hall layout — same rows × pattern the organiser
 *  painted, rendered here for the buyer instead of a flat list of
 *  buttons, so "where am I sitting" is an answerable question before
 *  paying. Taken seats are shown, not hidden — same as any airline
 *  seat picker — so the map reads as a real snapshot of the vehicle,
 *  not just what's left. Clicking a seat doesn't select it outright —
 *  it opens that seat's details below with an explicit Select action,
 *  so a buyer sees what they're getting (class, price, perks) before
 *  committing, and can't fat-finger a seat by mistake. */
function SeatMapPicker(
  { seatMap, seatedClasses, scheduleSeats, selectedSeats, onToggle }:
  {
    seatMap: { rows: number; pattern: string; seats: { label: string; ticketClassId: string }[] };
    seatedClasses: TicketClassOption[]; scheduleSeats: ScheduleSeat[];
    selectedSeats: Record<string, string[]>; onToggle: (classId: string, seatId: string) => void;
  },
) {
  const { left, right } = useMemo(() => columnsForPattern(seatMap.pattern), [seatMap.pattern]);
  const seatByLabel = useMemo(() => new Map(scheduleSeats.map((s) => [s.label, s])), [scheduleSeats]);
  const classById = useMemo(() => new Map(seatedClasses.map((c) => [c.id, c])), [seatedClasses]);
  const classIndex = useMemo(() => new Map(seatedClasses.map((c, i) => [c.id, i])), [seatedClasses]);
  const loading = scheduleSeats.length === 0;
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const activeSeat = activeLabel ? seatByLabel.get(activeLabel) : undefined;
  const activeClass = activeSeat ? classById.get(activeSeat.ticketClassId) : undefined;
  const activeSelected = activeSeat ? (selectedSeats[activeSeat.ticketClassId]?.includes(activeSeat.id) ?? false) : false;
  const activeTaken = activeSeat ? activeSeat.status !== 'AVAILABLE' : false;
  // Label is "<row><col>" — leading digits are the row, so this pulls
  // the row back out to know which column's aisle the popover belongs in.
  const activeRow = activeLabel ? Number(activeLabel.match(/^\d+/)?.[0]) : null;

  return (
    <div style={{ marginBottom: 20 }}>
      <p className="sub" style={{ display: 'block', marginBottom: 10, fontWeight: 600 }}>Pick your seat</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        {seatedClasses.map((c, i) => (
          <span key={c.id} className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem' }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: CLASS_COLOURS[i % CLASS_COLOURS.length], display: 'inline-block', border: '1px solid var(--line)' }} />
            {c.name} — KES {c.priceKes.toLocaleString('en-KE')}
          </span>
        ))}
        <span className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem' }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--line)', display: 'inline-block' }} />
          Taken
        </span>
      </div>

      {loading ? (
        <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>Loading seat availability…</p>
      ) : (
        <>
          {/* Rotated: the bus runs right → left (front of the bus on the
              right, row 1 there), scrolling horizontally instead of
              stacking every row down the page — a long coach shouldn't
              cost a buyer that much vertical scroll. flexDirection
              row-reverse keeps DOM/tab order at row 1 first while
              placing it visually on the right. */}
          <div style={{ overflowX: 'auto', overflowY: 'visible', padding: '4px 0 160px' }}>
            <div style={{ display: 'inline-flex', flexDirection: 'row-reverse', gap: 10 }}>
              {Array.from({ length: seatMap.rows }, (_, i) => i + 1).map((row) => (
                <div key={row} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}>
                  <span className="sub mono" style={{ fontSize: '.68rem' }}>{row}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {left.map((col) => (
                      <PickSeatCell key={col} label={`${row}${col}`} seat={seatByLabel.get(`${row}${col}`)}
                        classIndex={classIndex} selectedSeats={selectedSeats}
                        active={activeLabel === `${row}${col}`} onClick={() => setActiveLabel(`${row}${col}`)} />
                    ))}
                  </div>
                  {/* The aisle gap — doubles as the anchor for this
                      row's seat-detail popover, so "select" shows up
                      right where the aisle is instead of pulling focus
                      down to a card below the whole map. */}
                  <div style={{ height: 14, position: 'relative' }} aria-hidden={!(row === activeRow && activeSeat && activeClass)}>
                    {row === activeRow && activeSeat && activeClass && (
                      <div className="card" style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        zIndex: 20, width: 190, padding: 12, boxShadow: '0 4px 16px rgba(0,0,0,.15)',
                      }}>
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <strong style={{ fontSize: '.9rem' }}>Seat {activeSeat.label}</strong>
                            <p className="sub" style={{ margin: '2px 0 0', fontSize: '.78rem' }}>
                              {activeClass.name} — KES {activeClass.priceKes.toLocaleString('en-KE')}
                            </p>
                          </div>
                          <button type="button" className="btn btn-sm btn-o" style={{ padding: 4 }}
                            onClick={() => setActiveLabel(null)} aria-label="Close seat details">
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                        {((activeClass.amenities?.length ?? 0) > 0 || activeClass.amenityNote) && (
                          <p className="sub" style={{ margin: '6px 0 0', fontSize: '.72rem' }}>
                            {(activeClass.amenities ?? []).map((a) => AMENITY_BADGES[a] ?? a).join('  ')}
                            {activeClass.amenityNote ? `  +${activeClass.amenityNote}` : ''}
                          </p>
                        )}
                        {activeTaken ? (
                          <p className="sub" style={{ margin: '8px 0 0', fontSize: '.75rem' }}>Already booked by someone else.</p>
                        ) : (
                          <button type="button" className={`btn btn-sm ${activeSelected ? 'btn-o' : 'btn-p'}`}
                            style={{ marginTop: 10, width: '100%' }}
                            onClick={() => onToggle(activeSeat.ticketClassId, activeSeat.id)}>
                            {activeSelected ? 'Remove this seat' : 'Select this seat'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {right.map((col) => (
                      <PickSeatCell key={col} label={`${row}${col}`} seat={seatByLabel.get(`${row}${col}`)}
                        classIndex={classIndex} selectedSeats={selectedSeats}
                        active={activeLabel === `${row}${col}`} onClick={() => setActiveLabel(`${row}${col}`)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PickSeatCell(
  { label, seat, classIndex, selectedSeats, active, onClick }:
  {
    label: string; seat: ScheduleSeat | undefined; classIndex: Map<string, number>;
    selectedSeats: Record<string, string[]>; active: boolean; onClick: () => void;
  },
) {
  if (!seat) return <span style={{ width: 30, height: 30 }} aria-hidden />; // unsold position on the map

  const taken = seat.status !== 'AVAILABLE';
  const selected = selectedSeats[seat.ticketClassId]?.includes(seat.id) ?? false;
  const idx = classIndex.get(seat.ticketClassId) ?? 0;

  return (
    <button type="button"
      title={taken ? `${label} — already booked` : label}
      onClick={onClick}
      style={{
        width: 30, height: 30, fontSize: '.65rem', borderRadius: 6,
        border: selected ? '2px solid var(--fg, #111)' : active ? '2px solid var(--blue, #2563eb)' : '1.5px solid var(--line)',
        background: taken ? 'var(--line)' : CLASS_COLOURS[idx % CLASS_COLOURS.length],
        color: taken ? 'var(--tx-2)' : 'var(--tx-1)',
        cursor: 'pointer', padding: 0,
        opacity: taken ? 0.55 : 1,
      }}>
      {label}
    </button>
  );
}
