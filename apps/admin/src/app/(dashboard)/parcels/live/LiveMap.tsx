'use client';

import dynamic from 'next/dynamic';
import type { LiveCourierPosition, LiveUnassignedParcel } from '../actions';

// Leaflet touches `window` at import time, so it can only ever run in
// the browser — ssr:false has to live inside a client component (Next's
// App Router refuses next/dynamic(..., {ssr:false}) called directly
// from a Server Component), hence this one-line wrapper around the
// component that actually renders react-leaflet.
const MapInner = dynamic(() => import('./MapInner').then((m) => m.MapInner), {
  ssr: false,
  loading: () => <div className="card" style={{ padding: 40, textAlign: 'center' }}>Loading map…</div>,
});

export function LiveMap({
  couriers, parcels,
}: { couriers: LiveCourierPosition[]; parcels: LiveUnassignedParcel[] }) {
  return <MapInner couriers={couriers} parcels={parcels} />;
}
