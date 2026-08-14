'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateBooking, actionListAvailableSeats, actionCheckBookingStatus } from './actions';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

interface TicketClass { id: string; name: string; priceKes: number; seated: boolean; capacity: number }
interface Schedule { id: string; departAt: string }

export function BookingForm(
  { schedules, ticketClasses, buyerName, buyerMsisdn }:
  { schedules: Schedule[]; ticketClasses: TicketClass[]; buyerName: string; buyerMsisdn: string },
) {
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [seatOptions, setSeatOptions] = useState<Record<string, { id: string; label: string }[]>>({});
  const [selectedSeats, setSelectedSeats] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<'form' | 'waiting' | 'success'>('form');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const announce = useAnnounce();

  // Poll while a real Daraja callback is in flight — console mode never
  // reaches 'waiting' at all, since the push auto-confirms before
  // actionCreateBooking returns. Same shape as apps/store's checkout.
  useEffect(() => {
    if (stage !== 'waiting' || !bookingId) return;
    const t = setInterval(async () => {
      const res = await actionCheckBookingStatus(bookingId);
      if (res?.status === 'PAID') { setStage('success'); announce('Payment received.', 'polite'); }
    }, 4000);
    return () => clearInterval(t);
  }, [stage, bookingId, announce]);

  const seatedClasses = ticketClasses.filter((c) => c.seated);

  useEffect(() => {
    if (!scheduleId) return;
    for (const c of seatedClasses) {
      actionListAvailableSeats(scheduleId, c.id).then((seats) =>
        setSeatOptions((prev) => ({ ...prev, [c.id]: seats })));
    }
    setSelectedSeats({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId]);

  const totalKes = useMemo(() => {
    let sum = 0;
    for (const c of ticketClasses) {
      if (c.seated) sum += (selectedSeats[c.id]?.length ?? 0) * c.priceKes;
      else sum += (quantities[c.id] ?? 0) * c.priceKes;
    }
    return sum;
  }, [quantities, selectedSeats, ticketClasses]);

  function toggleSeat(classId: string, seatId: string) {
    setSelectedSeats((prev) => {
      const cur = prev[classId] ?? [];
      const next = cur.includes(seatId) ? cur.filter((s) => s !== seatId) : [...cur, seatId];
      return { ...prev, [classId]: next };
    });
  }

  function submit() {
    setError(null);
    const lines = ticketClasses.flatMap((c) => {
      if (c.seated) return (selectedSeats[c.id] ?? []).map((seatId) => ({ ticketClassId: c.id, seatId }));
      const qty = quantities[c.id] ?? 0;
      return Array.from({ length: qty }, () => ({ ticketClassId: c.id }));
    });
    if (lines.length === 0) { setError('Pick at least one ticket'); return; }

    start(async () => {
      const r = await actionCreateBooking({
        scheduleId, buyerName, buyerMsisdn, paymentMethod: 'MPESA_STK', lines,
      });
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); return; }

      setBookingId(r.data.bookingId);
      if (r.data.status === 'PAID') {
        setStage('success');
        announce('Payment received.', 'polite');
      } else {
        setStage('waiting');
        announce('Check your phone for the M-Pesa prompt.', 'polite');
        if ('warning' in r && r.warning) { setError(r.warning); announce(r.warning, 'assertive'); }
      }
    });
  }

  if (stage === 'success') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Booked</h3>
        <p className="sub" style={{ margin: '0 0 16px' }}>Your ticket and its QR code are ready.</p>
        <a href={`${APP_URL}/me/tickets`} className="btn btn-p">View your tickets</a>
      </div>
    );
  }

  if (stage === 'waiting') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="phone-call" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Check your phone</h3>
        <p className="sub" style={{ margin: '0 0 16px' }}>
          Enter your M-Pesa PIN on the prompt sent to {buyerMsisdn}. This updates on its own once
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

      {ticketClasses.map((c) => (
        <div style={{ marginBottom: 16 }} key={c.id}>
          <label className="sub" style={{ display: 'block', marginBottom: 6 }}>
            {c.name} — KES {c.priceKes.toLocaleString('en-KE')}{c.seated ? ' / seat' : ''}
          </label>
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
      ))}

      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)', marginBottom: 16 }}>
        <span className="sub">Total</span><span className="mono" style={{ fontWeight: 700 }}>KES {totalKes.toLocaleString('en-KE')}</span>
      </div>

      {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }} role="alert">
        <Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending || totalKes <= 0} onClick={submit}>
        {pending ? 'Booking…' : `Book · KES ${totalKes.toLocaleString('en-KE')}`}
      </button>
      <p className="sub" style={{ margin: '10px 0 0', fontSize: '.8rem' }}>
        You'll get an M-Pesa prompt to pay once the booking is created.
      </p>
    </div>
  );
}
