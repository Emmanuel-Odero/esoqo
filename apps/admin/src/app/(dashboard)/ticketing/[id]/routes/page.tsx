import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { can, AuthorisationError } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { OrgTabs } from '../OrgTabs';
import { RouteVenuePanel } from './RouteVenuePanel';
import { adminGo, adminOrgForCan, type GoConsoleOrg, type GoVenueRow, type GoRouteRow } from '@/lib/go-ticketing';

export const dynamic = 'force-dynamic';

const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };
const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

/** An organiser's venues (halls, grounds) and, for a transport company,
 *  its routes (origin → destination pairs). Both are the fixed
 *  geography a listing schedules against — set up once, reused by
 *  every listing and occurrence. */
export default async function OrgRoutesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;

  const org = await adminGo<{ org: GoConsoleOrg }>(`/v1/ticketorgs/${id}`)
    .then((r) => adminOrgForCan(r.org))
    .catch((e) => {
      if (e instanceof AuthorisationError) notFound();
      throw e;
    });

  const canManage = can(ctx, 'venue.write', { partyId: org.enterprise?.partyId })
    || can(ctx, 'route.write', { partyId: org.enterprise?.partyId });
  if (!canManage) notFound();

  const places = await adminGo<{ venues: GoVenueRow[]; routes: GoRouteRow[] }>(`/v1/ticketorgs/${id}/venues-routes`);
  const { venues, routes } = places;

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

      <OrgTabs orgId={id} active="routes" tabs={{ routes: true, listings: true, bookings: true }} />

      <RouteVenuePanel
        orgId={id}
        vertical={org.vertical}
        venues={venues.map((v) => ({ id: v.id, name: v.name, address: v.address, county: v.county, capacity: v.capacity }))}
        routes={routes.map((r) => ({ id: r.id, originName: r.originName, destinationName: r.destinationName, distanceKm: r.distanceKm }))}
      />
    </>
  );
}
