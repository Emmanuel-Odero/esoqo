import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { can, AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { OrgTabs } from '../OrgTabs';
import { ListingsPanel } from './ListingsPanel';
import { adminGo, adminOrgForCan, type GoConsoleOrg, type GoConsoleListing, type GoVenueRow, type GoRouteRow } from '@/lib/go-ticketing';

export const dynamic = 'force-dynamic';

const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };
const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

/** An organiser's listings — draft and published alike — with their
 *  schedules and ticket-class counts. The staff-facing counterpart to
 *  the org owner's own /org/[orgId]/listings. */
export default async function OrgListingsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;

  const org = await adminGo<{ org: GoConsoleOrg }>(`/v1/ticketorgs/${id}`)
    .then((r) => adminOrgForCan(r.org))
    .catch((e) => {
      if (e instanceof AuthorisationError) notFound();
      throw e;
    });

  if (!can(ctx, 'listing.write', { partyId: org.enterprise?.partyId })) notFound();

  const [listings, places] = await Promise.all([
    adminGo<{ listings: GoConsoleListing[] }>(`/v1/ticketorgs/${id}/listings`).then((r) => r.listings),
    adminGo<{ venues: GoVenueRow[]; routes: GoRouteRow[] }>(`/v1/ticketorgs/${id}/venues-routes`),
  ]);
  const { venues, routes } = places;

  const canPublish = can(ctx, 'listing.publish', { partyId: org.enterprise?.partyId });

  return (
    <>
      <div className="head">
        <div>
          <Link href="/ticketing" className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="arrow-left" size={14} />Back to organisers
          </Link>
          <h1>{org.name}</h1>
          <p>
            {VERTICAL_LABEL[org.vertical] ?? org.vertical} ·{' '}
            <span className={`pill ${STATUS_PILL[org.status]}`}>{org.status}</span>
          </p>
        </div>
      </div>

      <OrgTabs orgId={id} active="listings" tabs={{ routes: true, listings: true, bookings: true }} />

      <ListingsPanel
        orgId={id}
        canPublish={canPublish}
        venues={venues.map((v) => ({ id: v.id, name: v.name }))}
        routes={routes.map((r) => ({ id: r.id, label: `${r.originName} → ${r.destinationName}` }))}
        listings={listings.map((l) => ({
          id: l.id,
          title: l.title,
          status: l.status,
          venueName: l.venue?.name ?? null,
          routeLabel: l.route ? `${l.route.originName} → ${l.route.destinationName}` : null,
          ticketClassCount: l.ticketClasses.length,
          scheduleCount: l.schedules.length,
          createdAt: new Date(l.createdAt).toISOString(),
        }))}
      />
    </>
  );
}
