import { notFound } from 'next/navigation';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg } from '@/lib/ticketing';
import { listShortRoutes, type ShortRoute } from '@/lib/fleet';
import { PricingPanel } from './PricingPanel';

export const dynamic = 'force-dynamic';

/**
 * The company's fare card — routes and the fare charged between their
 * stages. fleet.read to see it, fleet.write to change it; the panel
 * decides what to draw, core-go decides what is allowed.
 */
export default async function FleetPricingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();
  if (!canOrg(ctx, org, 'fleet.read')) notFound();

  const routes = await listShortRoutes(orgId).catch(() => [] as ShortRoute[]);
  const canEdit = canOrg(ctx, org, 'fleet.write');

  return (
    <>
      <div className="mehead">
        <h1>Pricing</h1>
        <p>Fares per stage along each route.</p>
      </div>
      <PricingPanel orgId={orgId} routes={routes} canEdit={canEdit} />
    </>
  );
}
