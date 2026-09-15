'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  actionGetCourierPosition,
  type CourierPositionView, type ParcelStatusView, type ParcelTripView,
} from './actions';

/**
 * Live parcel position, polled while the page is open.
 *
 * ssr:false because Leaflet touches `window` at import time, and
 * lazily because this is a guest page on a mobile connection — someone
 * who opened a tracking link to read one status line should not pay for
 * a mapping library in their initial bundle.
 *
 * The component renders nothing at all when there is no position and no
 * agent to show, which is the common case (booked, delivered, or a
 * courier whose phone hasn't pinged recently). An empty grey rectangle
 * labelled "map" is worse than no map.
 */
const TrackingMapInner = dynamic(
  () => import('./TrackingMapInner').then((m) => m.TrackingMapInner),
  {
    ssr: false,
    loading: () => (
      <div style={{
        height: 240, borderRadius: 10, border: '1px solid var(--line)',
        display: 'grid', placeItems: 'center',
      }}>
        <span className="sub" style={{ fontSize: '.85rem' }}>Loading map…</span>
      </div>
    ),
  },
);

// 30s. Couriers ping every 30s while their jobs tab is open (see the
// mobile hub's ping loop), so polling faster only costs requests
// without ever producing a newer dot.
const POLL_MS = 30_000;

export function TrackingMap({ parcel }: { parcel: ParcelStatusView }) {
  const [position, setPosition] = useState<CourierPositionView | null>(null);
  const [trip, setTrip] = useState<ParcelTripView | null>(null);
  const moving = parcel.status === 'PICKED_UP' || parcel.status === 'IN_TRANSIT';

  useEffect(() => {
    if (!moving) return;
    let cancelled = false;
    async function tick() {
      const next = await actionGetCourierPosition(parcel.code);
      if (!cancelled) { setPosition(next.position); setTrip(next.trip); }
    }
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [moving, parcel.code]);

  const agent = parcel.status === 'HELD_AT_AGENT' ? parcel.agent ?? null : null;
  if (!position && !agent) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <TrackingMapInner
        position={position}
        agent={agent}
        destinationLabel={parcel.destinationLabel}
      />
      {/* A plate number is the thing that makes this feel real: it
          turns "somewhere in transit" into a vehicle a person can
          picture and, uniquely here, go and stand next to. */}
      {trip && (
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.82rem' }}>
          On bus <strong className="mono">{trip.vehiclePlate}</strong>
          {trip.routeName && <> · {trip.routeName}</>}
          {trip.orgName && <> · {trip.orgName}</>}
          {trip.dropStageName && <><br />Coming off at {trip.dropStageName}.</>}
        </p>
      )}
      {position && (
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.78rem' }}>
          {position.staleMins <= 2
            ? trip
              ? 'Live position, updating as the bus moves.'
              : 'Live position, updating as the courier moves.'
            : `Last seen ${position.staleMins} minutes ago.`}
        </p>
      )}
    </div>
  );
}
