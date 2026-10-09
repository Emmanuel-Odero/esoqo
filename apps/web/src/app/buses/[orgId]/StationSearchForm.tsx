'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import type { BusStation } from '../actions';

// Trips only exist up to EnsureBusTripsGenerated's own horizon (see
// core-go), so there is no point letting a traveller pick a date the
// company hasn't generated departures for yet.
const TRIP_HORIZON_DAYS = 14;

// One checkout can book several seats at once (travelling as a
// group), but a single guest booking that many in one go is already
// unusual — 8 keeps the picker short without being a real limit for
// almost anyone.
const MAX_PASSENGERS = 8;

function nairobiDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(d);
}

/**
 * The actual starting point for a traveller: where do you board, and
 * where do you alight — not which route it technically is. A route
 * from Nairobi to Homabay via Kisii should be findable by a Kisii
 * rider too, so this searches the company's whole station network
 * rather than only its route cards' overall endpoints.
 */
export function StationSearchForm({
  orgId, stations, initialFrom, initialTo, initialDate, initialPassengers,
}: {
  orgId: string; stations: BusStation[]; initialFrom?: string; initialTo?: string; initialDate?: string;
  initialPassengers?: string;
}) {
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [date, setDate] = useState(initialDate ?? '');
  const [passengers, setPassengers] = useState(initialPassengers ?? '1');
  const router = useRouter();

  const today = nairobiDateString(new Date());
  const maxDate = nairobiDateString(new Date(Date.now() + (TRIP_HORIZON_DAYS - 1) * 86400000));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to || from === to || !date) return;
    const qs = new URLSearchParams({ from, to, date, passengers });
    router.push(`/buses/${orgId}?${qs.toString()}`);
  }

  return (
    <form className="card sbar" onSubmit={submit}>
      <label className="pfield">
        <span>Board at</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)} required>
          <option value="">Choose a station…</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id} disabled={s.id === to}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="pfield">
        <span>Alight at</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} required>
          <option value="">Choose a station…</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id} disabled={s.id === from}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="pfield">
        <span>Travel date</span>
        <input
          type="date"
          value={date}
          min={today}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <label className="pfield">
        <span>Passengers</span>
        <select value={passengers} onChange={(e) => setPassengers(e.target.value)}>
          {Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n} {n === 1 ? 'passenger' : 'passengers'}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-p" disabled={!from || !to || from === to || !date}>
        <Icon name="search" size={16} />Find buses
      </button>
    </form>
  );
}
