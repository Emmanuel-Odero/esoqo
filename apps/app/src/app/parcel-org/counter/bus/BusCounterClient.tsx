'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { OrgBusRoute, OrgBusTrip } from '@/lib/parcel-org-session';
import { bookCounterBusSeat, getBusTripSeats, listOrgBusTrips } from '../../actions';

type Step = 'route' | 'trip' | 'seat' | 'done';

/**
 * Scan→confirm isn't available here (there's no code to scan — a
 * walk-in passenger just wants a seat), so this is the shortest form
 * that still is one: route, then trip, then seat, then the passenger's
 * details, each a single screen rather than one long form.
 */
export function BusCounterClient({ routes }: { routes: OrgBusRoute[] }) {
  const [step, setStep] = useState<Step>('route');
  const [, setRouteId] = useState('');
  const [trips, setTrips] = useState<OrgBusTrip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [trip, setTrip] = useState<OrgBusTrip | null>(null);
  const [seatsTotal, setSeatsTotal] = useState(0);
  const [takenSeats, setTakenSeats] = useState<number[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seatNumber, setSeatNumber] = useState<number | null>(null);
  const [passengerName, setPassengerName] = useState('');
  const [passengerMsisdn, setPassengerMsisdn] = useState('');
  const [passengerIdNumber, setPassengerIdNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; totalKes: string } | null>(null);
  const [pending, start] = useTransition();

  function pickRoute(id: string) {
    setRouteId(id);
    setError(null);
    setLoadingTrips(true);
    setStep('trip');
    void listOrgBusTrips(id)
      .then((t) => setTrips(t.filter((x) => x.seatsAvailable > 0)))
      .catch(() => setError('Could not load trips for that route.'))
      .finally(() => setLoadingTrips(false));
  }

  function pickTrip(t: OrgBusTrip) {
    setTrip(t);
    setError(null);
    setLoadingSeats(true);
    setStep('seat');
    void getBusTripSeats(t.id)
      .then((r) => { setSeatsTotal(r.seatsTotal); setTakenSeats(r.takenSeats); })
      .catch(() => setError('Could not load the seat map for that trip.'))
      .finally(() => setLoadingSeats(false));
  }

  function book() {
    if (!trip || !seatNumber) return;
    setError(null);
    start(async () => {
      const res = await bookCounterBusSeat({
        tripId: trip.id, seatNumber,
        passengerName, passengerMsisdn,
        passengerIdNumber: passengerIdNumber.trim() || null,
      });
      if (res.ok) {
        setResult({ code: res.code, totalKes: res.totalKes });
        setStep('done');
      } else {
        setError(res.error);
      }
    });
  }

  function reset() {
    setStep('route'); setRouteId(''); setTrips([]); setTrip(null);
    setSeatsTotal(0); setTakenSeats([]); setSeatNumber(null);
    setPassengerName(''); setPassengerMsisdn(''); setPassengerIdNumber('');
    setError(null); setResult(null);
  }

  return (
    <div className="porgroutes">
      {error && <p className="porg-export-note" role="status"><Icon name="alert-triangle" size={15} />{error}</p>}

      {step === 'route' && (
        <>
          {routes.length === 0 ? (
            <p className="porgroutes-empty">No active routes — add one in Settings → Transport first.</p>
          ) : (
            <ul className="porgroutes-list">
              {routes.map((r) => (
                <li key={r.id}>
                  <div className="porgroutes-id">
                    <span className="porgroutes-name">{r.originName} → {r.destinationName}</span>
                  </div>
                  <button type="button" className="btn btn-p btn-sm" onClick={() => pickRoute(r.id)}>Choose</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 'trip' && (
        <>
          <button type="button" className="btn btn-o btn-sm" onClick={reset} style={{ marginBottom: 12 }}>
            ← Back to routes
          </button>
          {loadingTrips ? (
            <p className="sub">Loading trips…</p>
          ) : trips.length === 0 ? (
            <p className="porgroutes-empty">No upcoming trips with seats left on this route.</p>
          ) : (
            <ul className="porgroutes-list">
              {trips.map((t) => (
                <li key={t.id}>
                  <div className="porgroutes-id">
                    <span className="porgroutes-name">
                      {new Date(t.departAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                    </span>
                    <span className="sub">
                      {t.busName} · KES {t.priceKes.toLocaleString('en-KE')} · {t.seatsAvailable} seats left
                    </span>
                  </div>
                  <button type="button" className="btn btn-p btn-sm" onClick={() => pickTrip(t)}>Choose</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 'seat' && trip && (
        <>
          <button type="button" className="btn btn-o btn-sm" onClick={() => setStep('trip')} style={{ marginBottom: 12 }}>
            ← Back to trips
          </button>
          <p className="sub">
            {trip.originName} → {trip.destinationName} · {new Date(trip.departAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })} · KES {trip.priceKes.toLocaleString('en-KE')}
          </p>

          {loadingSeats ? (
            <p className="sub">Loading seats…</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 8, maxWidth: 420, margin: '12px 0' }}>
              {Array.from({ length: seatsTotal }, (_, i) => i + 1).map((n) => {
                const taken = takenSeats.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={taken}
                    onClick={() => setSeatNumber(n)}
                    className={seatNumber === n ? 'btn btn-p btn-sm' : 'btn btn-o btn-sm'}
                    style={taken ? { opacity: 0.35, textDecoration: 'line-through' } : undefined}
                    aria-label={taken ? `Seat ${n}, taken` : `Seat ${n}`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          )}

          {seatNumber != null && (
            <div className="porgroutes-editor">
              <h3>Seat {seatNumber} — passenger details</h3>
              <div className="porgroutes-fields">
                <label>
                  <span>Full name</span>
                  <input value={passengerName} onChange={(e) => setPassengerName(e.target.value)} placeholder="Jane Wanjiru" />
                </label>
                <label>
                  <span>Phone number</span>
                  <input value={passengerMsisdn} onChange={(e) => setPassengerMsisdn(e.target.value)} placeholder="07XX XXX XXX" />
                </label>
                <label>
                  <span>ID number</span>
                  <input value={passengerIdNumber} onChange={(e) => setPassengerIdNumber(e.target.value)} placeholder="Optional" />
                </label>
              </div>
              <div className="porgroutes-actions">
                <button
                  type="button"
                  className="btn btn-p btn-sm"
                  onClick={book}
                  disabled={pending || !passengerName.trim() || !passengerMsisdn.trim()}
                >
                  {pending ? 'Booking…' : `Book seat ${seatNumber} — cash`}
                </button>
                <button type="button" className="btn btn-o btn-sm" onClick={() => setSeatNumber(null)} disabled={pending}>
                  Change seat
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {step === 'done' && result && trip && (
        <div className="porgroutes-editor">
          <h2><Icon name="check" size={18} />Seat booked</h2>
          <p className="sub">
            {trip.originName} → {trip.destinationName}, seat {seatNumber}, KES {Number(result.totalKes).toLocaleString('en-KE')}.
          </p>
          <p>
            Booking code: <span className="mono porgroutes-code">{result.code}</span>
          </p>
          <div className="porgroutes-actions">
            <button type="button" className="btn btn-p btn-sm" onClick={reset}>Sell another seat</button>
          </div>
        </div>
      )}
    </div>
  );
}
