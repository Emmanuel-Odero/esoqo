'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { searchParking, type ParkingSpot } from './actions';

/**
 * The parking finder.
 *
 * Two ways in: type an area, or ask the browser where you are. Both
 * call the same action, which is deliberately backend-less for now —
 * the only difference is what it would rank against. The results are a
 * grid of car parks, each of which opens that park's own pay-and-ticket
 * screen.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; lots: ParkingSpot[]; note: string }
  | { kind: 'empty'; note: string }
  | { kind: 'error'; message: string };

const TOWN_CHIPS = ['Nairobi', 'Mombasa', 'Kisumu', 'Eldoret'];

export function ParkingFinder() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const run = (note: string, input: { query?: string; lat?: number | null; lng?: number | null }) => {
    setState({ kind: 'loading' });
    startTransition(async () => {
      const res = await searchParking(input);
      if (res.status === 'RESULTS' && res.lots.length > 0) {
        setState({ kind: 'results', lots: res.lots, note });
      } else {
        setState({ kind: 'empty', note });
      }
    });
  };

  const submitQuery = (value: string) => {
    const q = value.trim();
    if (!q) return;
    run(`Car parks matching “${q}”`, { query: q });
  };

  const findNearMe = () => {
    if (!('geolocation' in navigator)) {
      setState({ kind: 'error', message: 'This browser cannot find your location — search by area instead.' });
      return;
    }
    setState({ kind: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (pos) => run('Car parks near your location', { lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setState({ kind: 'error', message: 'We could not get your location. Turn on location access, or search by area instead.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parking</p>
          <h1>Find parking</h1>
          <p className="lead">
            See the car parks around you, what each one charges, and pay for your stay by M-Pesa
            when you collect your car.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <form
            onSubmit={(e) => { e.preventDefault(); submitQuery(query); }}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <div className="fin-in" style={{ flex: '1 1 280px', minWidth: 0 }}>
              <span className="mg"><Icon name="search" size={18} /></span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by area, town or car park name"
                aria-label="Search for parking"
              />
            </div>
            <button type="submit" className="btn btn-p" disabled={pending}>
              <Icon name="arrow-right" size={16} />Search
            </button>
            <button type="button" className="btn btn-o" onClick={findNearMe} disabled={pending}>
              <Icon name="pin" size={16} />Find parking near me
            </button>
          </form>

          <div className="chips">
            {TOWN_CHIPS.map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                onClick={() => { setQuery(t); submitQuery(t); }}
                disabled={pending}
              >
                {t}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            {state.kind === 'idle' && (
              <div className="note n-blue">
                <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
                <p>
                  Type an area or town above, or let us find the car parks nearest you.
                </p>
              </div>
            )}

            {state.kind === 'loading' && (
              <div className="note n-blue">
                <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
                <p>Looking for car parks…</p>
              </div>
            )}

            {state.kind === 'error' && (
              <div className="note n-red">
                <span className="icbox icbox-r icbox-sm"><Icon name="alert-circle" size={16} /></span>
                <p>{state.message}</p>
              </div>
            )}

            {state.kind === 'empty' && (
              <div className="note n-blue">
                <span className="icbox icbox-b icbox-sm"><Icon name="pin" size={16} /></span>
                <p>
                  No car parks are showing here yet — we’re switching parking on area by area.
                  Check back soon, or{' '}
                  <Link href="/pay/parking">already parked? Open your ticket here</Link>.
                </p>
              </div>
            )}

            {state.kind === 'results' && (
              <>
                <p className="sub" style={{ margin: '0 0 14px' }}>{state.note}</p>
                <div className="grid g3">
                  {state.lots.map((lot) => (
                    <Link key={lot.code} className="acard" href={`/pay/parking/${lot.code}`}>
                      <span className="icbox icbox-a"><Icon name="pin" size={20} /></span>
                      <h3>{lot.name}</h3>
                      <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>
                        {lot.county ?? 'Kenya'}
                        {lot.address ? ` · ${lot.address}` : ''}
                      </p>
                      <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>
                        KES {lot.ratePerHourKes} an hour · {lot.graceMinutes} min free
                      </p>
                      <span className="go">See rates &amp; park <Icon name="arrow-right" size={15} /></span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}