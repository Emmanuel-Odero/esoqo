import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { DropoffPoll } from '../DropoffPoll';
import { listDispatches, listOrgStaff, listOrgStations } from '../actions';
import { DispatchBoard } from './DispatchBoard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Dispatch — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The dispatch board — the company's whole fleet on one page. Runs are
 * the unit a dispatcher thinks in (one vehicle, its crew, one leg,
 * one receiving team), not individual parcels: the parcels table stays
 * on /parcel-org, and this page shows where every fleet is and where
 * each is headed.
 */
export default async function DispatchPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    [me] = [await getParcelOrgMe()];
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  if (!me.capabilities.includes('parcelorg.dispatch')) redirect('/parcel-org');

  const [runs, stations, staff] = await Promise.all([
    listDispatches(true),
    listOrgStations(),
    listOrgStaff(),
  ]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Dispatch</h1>
          <p>
            Your whole fleet — where every run is headed, who is aboard, and who
            checks it in when it arrives.
          </p>
        </div>
      </div>

      <DropoffPoll />

      <DispatchBoard initialRuns={runs} stations={stations} staff={staff} />
    </>
  );
}
