import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgBusRoutes } from '../../actions';
import { BusCounterClient } from './BusCounterClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Bus tickets — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The counter's "sell a seat" desk for a transport-enabled courier
 * company — a walk-in passenger picks a route, a trip, a seat, hands
 * over cash, and gets a code. Always CASH, settled on the spot, same
 * reasoning the parcel counter's till sale follows.
 */
export default async function BusCounterPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
  // Selling a seat at the counter is always cash, so a company that
  // takes no cash (ParcelOrg.acceptsCash false) has no counter bus desk
  // either — same as the parcel counter's own cash rail being hidden.
  if (
    !me.org.offersTransport ||
    !me.capabilities.includes('parcelorg.transport-sell') ||
    me.org.acceptsCash === false
  ) {
    redirect('/parcel-org');
  }

  const routes = await listOrgBusRoutes();

  return (
    <>
      <div className="head">
        <div>
          <h1>Bus tickets</h1>
          <p>Sell a seat to a passenger at the counter.</p>
        </div>
      </div>
      <BusCounterClient routes={routes.filter((r) => r.active)} />
    </>
  );
}
