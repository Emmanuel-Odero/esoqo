import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getTicketOrg, getOrgListing, can, AuthorisationError, TicketingError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { OrgTabs } from '../../OrgTabs';
import { ListingDetailPanel } from './ListingDetailPanel';

export const dynamic = 'force-dynamic';

/** One listing's ticket classes and schedules — the org console's
 *  "sell-side" setup: what a buyer picks from (classes) and when
 *  (schedules), for the staff onboarding an organiser who isn't yet
 *  self-serving at /org/[orgId]/listings/[listingId]. */
export default async function ListingDetailPage({
  params,
}: { params: Promise<{ id: string; listingId: string }> }) {
  const ctx = await requireStaff();
  const { id, listingId } = await params;

  const org = await getTicketOrg(ctx, id).catch((e) => {
    if (e instanceof AuthorisationError) notFound();
    throw e;
  });

  if (!can(ctx, 'listing.write', { partyId: org.enterprise?.partyId })) notFound();

  const listing = await getOrgListing(ctx, id, listingId).catch((e) => {
    if (e instanceof AuthorisationError || e instanceof TicketingError) notFound();
    throw e;
  });

  return (
    <>
      <div className="head">
        <div>
          <Link href={`/ticketing/${id}/listings`} className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="arrow-left" size={14} />Back to listings
          </Link>
          <h1>{listing.title}</h1>
          <p>{org.name} · <span className="pill">{listing.status}</span></p>
        </div>
      </div>

      <OrgTabs orgId={id} active="listings" tabs={{ routes: true, listings: true, bookings: true }} />

      <ListingDetailPanel
        orgId={id}
        listingId={listingId}
        ticketClasses={listing.ticketClasses.map((tc) => ({
          id: tc.id, name: tc.name, priceKes: Number(tc.priceKes), capacity: tc.capacity, seated: tc.seated,
        }))}
        schedules={listing.schedules.map((s) => ({
          id: s.id,
          departAt: s.departAt.toISOString(),
          arriveAt: s.arriveAt ? s.arriveAt.toISOString() : null,
          gateInfo: s.gateInfo,
          vehicleOrHallLabel: s.vehicleOrHallLabel,
          status: s.status,
          bookingCount: s._count.bookings,
        }))}
      />
    </>
  );
}
