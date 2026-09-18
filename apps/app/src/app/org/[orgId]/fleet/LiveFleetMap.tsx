'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@esoqo/ui';
import type { ActiveTrail, VehiclePosition } from '@/lib/fleet';

/**
 * Leaflet touches `window` at import time, so the map can only ever be
 * a client component loaded after hydration — same ssr:false split the
 * admin console's live parcel map uses (see its LiveMap.tsx).
 */
const MapInner = dynamic(() => import('./MapInner').then((m) => m.MapInner), {
  ssr: false,
  loading: () => <Skeleton height={460} />,
});

export function LiveFleetMap({
  positions, trails,
}: { positions: VehiclePosition[]; trails: ActiveTrail[] }) {
  return <MapInner positions={positions} trails={trails} />;
}
