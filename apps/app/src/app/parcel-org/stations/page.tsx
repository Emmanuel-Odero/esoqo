import { redirect } from 'next/navigation';
import { getParcelOrgMe, ParcelOrgUnauthorised } from '@/lib/parcel-org-session';
import { listOrgStations } from '../actions';
import { StationsManager } from './StationsManager';

export const dynamic = 'force-dynamic';

export default async function ParcelOrgStationsPage() {
  try {
    const me = await getParcelOrgMe();
    if (!me.capabilities.includes('parcelorgstation.write')) redirect('/parcel-org');
    return <><div className="porg-head"><div><h1>Pickup stations</h1><p>Add and manage the places where receivers collect parcels.</p></div></div><StationsManager initial={await listOrgStations()} /></>;
  } catch (e) { if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out'); throw e; }
}