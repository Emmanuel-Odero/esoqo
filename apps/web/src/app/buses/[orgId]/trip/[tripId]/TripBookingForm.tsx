'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { createBusBooking, type BusTrip } from '../../../actions';

// Bus.seatLayout is manager-entered free text like "2+2", "2+3" or
// "3+2" (see BusEditor) — left-of-aisle seats, a plus, then
// right-of-aisle seats. Anything that doesn't parse that way (blank,
// legacy data, typos) falls back to the common 2+2 coach layout
// rather than failing to render a seat map at all.
function parseSeatLayout(layout: string | null): { left: number; right: number } {
  const m = layout?.match(/^\s*(\d+)\s*\+\s*(\d+)\s*$/);
  if (!m) return { left: 2, right: 2 };
  const left = Number(m[1]);
  const right = Number(m[2]);
  if (left < 1 || right < 1 || left > 4 || right > 4) return { left: 2, right: 2 };
  return { left, right };
}

/**
 * A seat button, shared between the regular rows and the back bench.
 */
function SeatButton({
  n, taken, selected, onSelect,
}: { n: number; taken: boolean; selected: boolean; onSelect: (n: number) => void }) {
  return (
    <button
      type="button"
      disabled={taken}
      onClick={() => onSelect(n)}
      className={`btn btn-sm ${selected ? 'btn-p' : 'btn-o'}`}
      style={{ minWidth: 46, padding: '9px 0', ...(taken ? { opacity: 0.35, textDecoration: 'line-through' } : {}) }}
      aria-label={taken ? `Seat ${n}, taken` : `Seat ${n}`}
    >
      {n}
    </button>
  );
}

/**
 * The bus's actual floor plan — two blocks of seats either side of a
 * centre aisle (sized from the bus's own seatLayout, e.g. "2+3" for a
 * coach with three seats on the kerb side), a driver box up front, and
 * any seats left over after filling whole rows gathered into one back
 * bench, the way a real coach's rear row usually runs unbroken across
 * the full width. Seat numbers simply count up row by row, left block
 * then right block — the booking only cares that each number is used
 * once, not which physical row it printed in.
 */
function SeatMap({
  seatLayout, seatsTotal, takenSeats, seatNumbers, onToggle,
}: {
  seatLayout: string | null; seatsTotal: number; takenSeats: number[]; seatNumbers: number[];
  onToggle: (n: number) => void;
}) {
  const { left, right } = parseSeatLayout(seatLayout);
  const perRow = left + right;
  const fullRows = Math.floor(seatsTotal / perRow);
  const backBench = seatsTotal - fullRows * perRow;

  let next = 1;
  const rows = Array.from({ length: fullRows }, () => {
    const leftSeats = Array.from({ length: left }, () => next++);
    const rightSeats = Array.from({ length: right }, () => next++);
    return { leftSeats, rightSeats };
  });
  const benchSeats = Array.from({ length: backBench }, () => next++);

  const seatProps = (n: number) => ({
    n, taken: takenSeats.includes(n), selected: seatNumbers.includes(n), onSelect: onToggle,
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="sub" style={{ fontSize: '.8rem' }}>Door</span>
        <span className="pill pill-navy" style={{ fontSize: '.72rem' }}>DRIVER</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              {r.leftSeats.map((n) => <SeatButton key={n} {...seatProps(n)} />)}
            </div>
            <div style={{ width: 20 }} />
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              {r.rightSeats.map((n) => <SeatButton key={n} {...seatProps(n)} />)}
            </div>
          </div>
        ))}
        {benchSeats.length > 0 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', paddingTop: 6, borderTop: '1px dashed var(--line)', marginTop: 4 }}>
            {benchSeats.map((n) => <SeatButton key={n} {...seatProps(n)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// A single guest checkout can book several seats at once — a
// passenger travelling with family picks one seat per person, pays
// once. MAX_PASSENGERS mirrors the search form's own cap.
const MAX_PASSENGERS = 8;

/**
 * Seats → passenger details → pay, one screen each. A booking is
 * created the moment every requested seat and the lead passenger's
 * details are confirmed; the form then routes to the booking's own
 * status page, which is where the M-Pesa wait (if any) and the
 * confirmation live — same split the ticketing checkout uses between
 * its form and /tickets/booking/[id].
 */
export function TripBookingForm({
  trip, seatsTotal, takenSeats, requestedSeats,
}: { trip: BusTrip; seatsTotal: number; takenSeats: number[]; requestedSeats: number }) {
  const seatsFree = seatsTotal - takenSeats.length;
  const [passengerCount, setPassengerCount] = useState(
    Math.max(1, Math.min(requestedSeats, MAX_PASSENGERS, Math.max(seatsFree, 1))),
  );
  const [seatNumbers, setSeatNumbers] = useState<number[]>([]);
  const [passengerName, setPassengerName] = useState('');
  const [passengerMsisdn, setPassengerMsisdn] = useState('');
  const [passengerIdNumber, setPassengerIdNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  const totalKes = trip.priceKes * passengerCount;

  function toggleSeat(n: number) {
    setSeatNumbers((prev) => {
      if (prev.includes(n)) return prev.filter((s) => s !== n);
      if (prev.length >= passengerCount) return prev;
      return [...prev, n];
    });
  }

  function changePassengerCount(n: number) {
    const next = Math.max(1, Math.min(n, MAX_PASSENGERS, Math.max(seatsFree, 1)));
    setPassengerCount(next);
    setSeatNumbers((prev) => prev.slice(0, next));
  }

  function submit() {
    setError(null);
    if (seatNumbers.length !== passengerCount) { setError(`Choose ${passengerCount} seat${passengerCount > 1 ? 's' : ''}`); return; }
    start(async () => {
      const res = await createBusBooking({
        tripId: trip.id, seatNumbers, passengerName, passengerMsisdn,
        passengerIdNumber: passengerIdNumber || undefined,
      });
      if (!res.ok) { setError(res.error); announce(res.error, 'assertive'); return; }
      router.push(`/buses/booking/${res.code}`);
    });
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 9, margin: 0 }}>
          <Icon name="truck" size={18} />Choose a seat
        </h3>
        <label className="row" style={{ gap: 8 }}>
          <span className="sub" style={{ fontSize: '.85rem' }}>Passengers</span>
          <select
            className="mono"
            style={{ padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.9rem' }}
            value={passengerCount}
            onChange={(e) => changePassengerCount(Number(e.target.value))}
          >
            {Array.from({ length: Math.max(1, Math.min(MAX_PASSENGERS, seatsFree)) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="sub" style={{ margin: '0 0 12px', fontSize: '.85rem' }}>
        {seatNumbers.length} of {passengerCount} seat{passengerCount > 1 ? 's' : ''} selected
      </p>

      <SeatMap
        seatLayout={trip.seatLayout}
        seatsTotal={seatsTotal}
        takenSeats={takenSeats}
        seatNumbers={seatNumbers}
        onToggle={toggleSeat}
      />

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="pg-name">Full name</label>
        <input id="pg-name" className="mono" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder="e.g. Wanjiku" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="pg-phone">Phone number</label>
        <input id="pg-phone" className="mono" inputMode="tel" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={passengerMsisdn} onChange={(e) => setPassengerMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>The M-Pesa prompt and your ticket go here.</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }} htmlFor="pg-id">ID number (optional)</label>
        <input id="pg-id" className="mono" style={{
          width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
        }} value={passengerIdNumber} onChange={(e) => setPassengerIdNumber(e.target.value)} placeholder="Optional" />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)', marginBottom: 16 }}>
        <span className="sub">
          Total{passengerCount > 1 ? ` (${passengerCount} seats × KES ${trip.priceKes.toLocaleString('en-KE')})` : ''}
        </span>
        <span className="mono" style={{ fontWeight: 700 }}>KES {totalKes.toLocaleString('en-KE')}</span>
      </div>

      {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }} role="alert">
        <Icon name="alert-circle" size={15} />{error}</p>}

      <button
        type="button"
        className="btn btn-p"
        style={{ width: '100%' }}
        disabled={pending || seatNumbers.length !== passengerCount || !passengerName.trim() || !passengerMsisdn.trim()}
        onClick={submit}
      >
        {pending
          ? 'Booking…'
          : `Book ${passengerCount > 1 ? `${passengerCount} seats` : 'seat'} · KES ${totalKes.toLocaleString('en-KE')}`}
      </button>
    </div>
  );
}
