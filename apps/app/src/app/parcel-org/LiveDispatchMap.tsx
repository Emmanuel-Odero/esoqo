'use client';

import dynamic from 'next/dynamic';
import type { OrgLiveParcel, OrgLiveRider, ParcelOrgStationRow } from '@/lib/parcel-org-session';

/**
 * Leaflet touches `window` at import time, so the map loads after
 * hydration — the same ssr:false split the fleet map and the admin
 * live map already use.
 */
const DispatchMapInner = dynamic(() => import('./DispatchMapInner').then((m) => m.DispatchMapInner), {
  ssr: false,
  loading: () => <div className="card" style={{ height: 420 }} />,
});

export function LiveDispatchMap({
  riders, parcels, stations,
}: {
  riders: OrgLiveRider[];
  parcels: OrgLiveParcel[];
  stations: ParcelOrgStationRow[];
}) {
  return <DispatchMapInner riders={riders} parcels={parcels} stations={stations} />;
}
