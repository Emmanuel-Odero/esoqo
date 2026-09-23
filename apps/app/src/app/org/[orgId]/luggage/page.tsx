import { notFound } from 'next/navigation';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg } from '@/lib/ticketing';
import {
  listFleetTrips, listShortRoutes,
  type FareStage, type FleetTrip, type ShortRoute,
} from '@/lib/fleet';
import { LuggageDesk } from './LuggageDesk';

export const dynamic = 'force-dynamic';

/**
 * Passenger luggage — the crew's desk, not a manager's report.
 *
 * Lives under the org console rather than beside parcels because a bag
 * belongs to a vehicle run: the trip is the first thing chosen here and
 * every tag is scoped to it. See LuggageTag's schema comment on why a
 * bag is not a small parcel.
 *
 * Capability gating below only decides what to draw. core-go's DAL is
 * the boundary (ADR-0003) and re-checks luggage.tag / luggage.claim /
 * luggage.read on every call.
 */
export default async function LuggagePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();

  // Reading the manifest is the floor: a session that cannot see what is
  // on the vehicle has no use for this page even if it could tag.
  if (!canOrg(ctx, org, 'luggage.read')) notFound();

  const canTag = canOrg(ctx, org, 'luggage.tag');
  const canClaim = canOrg(ctx, org, 'luggage.claim');

  // Each read guarded independently, the same rule the fleet console
  // follows: a role that can work luggage but not read the trip list
  // should get a page that says so, not one that 403s.
  const [trips, routes] = await Promise.all([
    listFleetTrips(orgId).catch(() => [] as FleetTrip[]),
    listShortRoutes(orgId).catch(() => [] as ShortRoute[]),
  ]);

  const routeNameById = new Map(routes.map((r) => [r.ID, r.Name]));
  // Mapped here, once, so the Go field-name convention the fleet wire
  // structs must preserve (VehiclePlate, ShortRouteID) stops at the
  // server boundary instead of spreading into the crew UI.
  const active = trips
    .filter((t) => t.Status === 'ACTIVE')
    .map((t) => ({
      id: t.ID,
      plate: t.VehiclePlate,
      routeId: t.ShortRouteID,
      routeName: t.ShortRouteID ? (routeNameById.get(t.ShortRouteID) ?? null) : null,
    }));

  // The destination chips, keyed by route. Flattened here rather than
  // fetched per trip in the client: the list is small, it never changes
  // mid-shift, and a conductor tapping a chip must not wait on a round
  // trip to find out what the chips are.
  const stagesByRoute: Record<string, FareStage[]> = {};
  for (const r of routes) {
    if (r.Stages?.length) {
      stagesByRoute[r.ID] = [...r.Stages].sort((a, b) => a.Order - b.Order);
    }
  }

  return (
    <section>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Luggage</h1>
        <p className="sub" style={{ margin: '6px 0 0', maxWidth: '62ch' }}>
          Tag a passenger’s bags onto the vehicle, and hand them back at
          the other end. Anything still aboard when the trip closes shows
          up on the close-out while you are still holding it.
        </p>
      </header>

      <LuggageDesk
        orgId={orgId}
        trips={active}
        stagesByRoute={stagesByRoute}
        orgName={org.name}
        webUrl={process.env.NEXT_PUBLIC_WEB_URL ?? ''}
        canTag={canTag}
        canClaim={canClaim}
      />
    </section>
  );
}
