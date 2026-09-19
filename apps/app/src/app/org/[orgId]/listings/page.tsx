import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg, type GoListing, type GoVenue, type GoRoute } from '@/lib/ticketing';
import { CreateListingForm } from './CreateListingForm';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'var(--tx-2)', PUBLISHED: 'var(--green)', SUSPENDED: 'var(--amber)', CANCELLED: 'var(--red)',
};

export default async function OrgListings({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();
  // A SCANNER session reaches requireOrgAccess fine but holds no
  // listing.write — this tab isn't in their nav, but a direct URL visit
  // must still be refused rather than crash on the enforcement check.
  if (!canOrg(ctx, org, 'listing.write')) notFound();
  const [listings, places] = await Promise.all([
    orgGo<{ listings: GoListing[] }>(orgId, `/v1/ticketorgs/${orgId}/listings`).then((r) => r.listings)
      .catch(() => []),
    orgGo<{ venues: GoVenue[]; routes: GoRoute[] }>(orgId, `/v1/ticketorgs/${orgId}/venues-routes`)
      .then((r) => ({ venues: r.venues, routes: r.routes }))
      .catch(() => ({ venues: [], routes: [] })),
  ]);

  return (
    <>
      <div className="mehead">
        <h1>Listings</h1>
        <p>{org.vertical === 'TRANSPORT' ? 'Trips' : 'Events'} this organiser runs — draft until you publish.</p>
      </div>

      <CreateListingForm
        orgId={orgId}
        vertical={org.vertical}
        venues={places.venues.map((v) => ({ id: v.id, label: v.name }))}
        routes={places.routes.map((r) => ({ id: r.id, label: `${r.originName} → ${r.destinationName}` }))}
      />

      {listings.length === 0 ? (
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name={org.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing yet</h2>
            <p style={{ margin: 0 }}>Create your first listing above.</p>
          </div>
        </div>
      ) : (
        listings.map((l) => (
          <Link key={l.id} href={`/org/${orgId}/listings/${l.id}`} className="mcard"
            style={{ display: 'block', marginBottom: 12, textDecoration: 'none', color: 'inherit' }}>
            <h2>{l.title}</h2>
            <div className="mrow"><span className="k">Status</span>
              <span className="v" style={{ color: STATUS_TONE[l.status] }}>{l.status.toLowerCase()}</span></div>
            <div className="mrow"><span className="k">Ticket classes</span><span className="v">{l.ticketClasses.length}</span></div>
            <div className="mrow"><span className="k">Occurrences</span><span className="v">{l.schedules.length}</span></div>
          </Link>
        ))
      )}
    </>
  );
}
