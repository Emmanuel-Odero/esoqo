'use client';

import dynamic from 'next/dynamic';
import type { DispatchRun } from '@/lib/parcel-org-session';

/**
 * Leaflet touches `window` at import time, so the map loads after
 * hydration — the same ssr:false split every other map in the app uses.
 */
const FleetDispatchMapInner = dynamic(
  () => import('./FleetDispatchMapInner').then((m) => m.FleetDispatchMapInner),
  {
    ssr: false,
    loading: () => <div className="card" style={{ height: 480 }} />,
  },
);

export function FleetDispatchMap({
  runs, selectedId, onSelect,
}: {
  runs: DispatchRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return <FleetDispatchMapInner runs={runs} selectedId={selectedId} onSelect={onSelect} />;
}
