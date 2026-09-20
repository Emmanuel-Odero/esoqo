import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listOrgRoutes, listOrgStations } from '../../actions';
import { RoutesManager } from './RoutesManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Routes — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The company's own map: which stations it serves, in what order.
 *
 * Before this, a run's places were three free-text columns, so
 * "Nairobi", "nairobi" and "NBO" were three different destinations,
 * nothing could be grouped or priced by route, and there was no way to
 * say where a parcel changes vehicle (ADR-0006).
 *
 * In Settings rather than Dispatch on purpose, and by the same rule as
 * Stations: defining where the company goes is configuration a manager
 * does monthly. Driving one of those routes is Dispatch, daily.
 */
export default async function ParcelOrgRoutesPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }
  if (!me.capabilities.includes('parcelorg.write')) redirect('/parcel-org');

  const [routes, stations] = await Promise.all([listOrgRoutes(), listOrgStations()]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Routes</h1>
          <p>
            The legs you run, in order. A run can follow one of these or be opened
            ad-hoc for a vehicle nobody planned for.
          </p>
        </div>
      </div>
      <RoutesManager routes={routes} stations={stations} />
    </>
  );
}
