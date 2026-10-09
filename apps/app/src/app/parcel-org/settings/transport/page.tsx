import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgBuses, listOrgBusRoutes, listOrgBusSchedules, listOrgBusTrips } from '../../actions';
import { TransportManager } from './TransportManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Transport — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The bus side of a transport-enabled courier company: its fleet, the
 * recurring schedules that set a fare and a capacity for a bus on one
 * of the company's own routes, and the concrete upcoming trips
 * generated from them. The routes themselves are managed at Settings →
 * Routes — a bus rides the SAME station network a parcel run does,
 * not a separate one. Same "configuration a manager does monthly"
 * tier as Routes, which is why it lives in Settings rather than
 * Counter — selling a seat is Counter's job, daily.
 */
export default async function ParcelOrgTransportPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
  if (!me.capabilities.includes('parcelorg.transport') || !me.org.offersTransport) {
    redirect('/parcel-org');
  }

  const [buses, routes, schedules, trips] = await Promise.all([
    listOrgBuses(),
    listOrgBusRoutes(),
    listOrgBusSchedules(),
    listOrgBusTrips(),
  ]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Transport</h1>
          <p>
            Your buses, the routes they run, and the schedules that set a fare
            and a capacity for each one. Upcoming trips are generated from
            your schedules automatically.
          </p>
        </div>
      </div>
      <TransportManager buses={buses} routes={routes} schedules={schedules} trips={trips} />
    </>
  );
}
