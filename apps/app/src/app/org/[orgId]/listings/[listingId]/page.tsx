import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { type AmenityTag } from '@esoqo/domain';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg, type GoListing, type GoSeatMap } from '@/lib/ticketing';
import { TicketClassForm } from './TicketClassForm';
import { ScheduleForm } from './ScheduleForm';
import { PublishControls } from './PublishControls';
import { SeatMapBuilder } from './SeatMapBuilder';

export const dynamic = 'force-dynamic';

const AMENITY_LABELS: Record<AmenityTag, string> = {
  WIFI: 'WiFi', SNACKS: 'Snacks', CHARGING: 'Charging', RECLINING: 'Reclining',
  EXTRA_LEGROOM: 'Extra legroom', BLANKET: 'Blanket',
};

export default async function ListingDetail(
  { params }: { params: Promise<{ orgId: string; listingId: string }> },
) {
  const { orgId, listingId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();
  const listing = await orgGo<{ listing: GoListing }>(orgId, `/v1/ticketorgs/${orgId}/listings/${listingId}`)
    .then((r) => r.listing)
    .catch(() => null);
  if (!listing) notFound();

  const canPublish = canOrg(ctx, org, 'listing.publish');
  const canWriteClasses = canOrg(ctx, org, 'ticketclass.write');
  const canWriteSchedules = canOrg(ctx, org, 'schedule.write');

  const seatedClasses = listing.ticketClasses.filter((c) => c.seated);
  const seatMap = canWriteClasses && seatedClasses.length > 0
    ? await orgGo<{ seatMap: GoSeatMap | null }>(orgId, `/v1/org-listings/${listingId}/seatmap`)
        .then((r) => r.seatMap)
        .catch(() => null)
    : null;

  return (
    <>
      <div className="mehead">
        <h1>{listing.title}</h1>
        <p>{listing.description || 'No description yet.'}</p>
      </div>

      <div className="mcard" style={{ marginBottom: 16 }}>
        <div className="mrow"><span className="k">Status</span><span className="v">{listing.status.toLowerCase()}</span></div>
        <div className="mrow"><span className="k">{org.vertical === 'TRANSPORT' ? 'Route' : 'Venue'}</span>
          <span className="v">{listing.venue?.name ?? (listing.route ? `${listing.route.originName} → ${listing.route.destinationName}` : '—')}</span></div>
        <PublishControls orgId={orgId} listingId={listingId} status={listing.status} canPublish={canPublish} />
      </div>

      {canWriteClasses && <TicketClassForm orgId={orgId} listingId={listingId} />}

      <div className="mcard" style={{ marginBottom: 16 }}>
        <h2><Icon name="tag" size={18} />Ticket classes</h2>
        {listing.ticketClasses.length === 0 ? <p style={{ margin: 0, color: 'var(--tx-2)' }}>None yet.</p> : (
          listing.ticketClasses.map((tc) => (
            <div className="mrow" key={tc.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <span className="k">{tc.name}</span>
                <span className="v">KES {Number(tc.priceKes).toLocaleString('en-KE')} · {tc.capacity} {tc.seated ? 'seats' : 'slots'} per occurrence</span>
              </div>
              {(tc.amenities.length > 0 || tc.amenityNote) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tc.amenities.map((a) => (
                    <span key={a} className="chip" style={{ fontSize: '.75rem' }}>{AMENITY_LABELS[a as AmenityTag] ?? a}</span>
                  ))}
                  {tc.amenityNote && <span className="chip" style={{ fontSize: '.75rem' }}>{tc.amenityNote}</span>}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {canWriteClasses && seatedClasses.length > 0 && (
        <SeatMapBuilder
          orgId={orgId} listingId={listingId}
          seatedClasses={seatedClasses.map((c) => ({ id: c.id, name: c.name, priceKes: Number(c.priceKes) }))}
          existing={seatMap ? { rows: seatMap.rows, pattern: seatMap.pattern, seats: seatMap.seats } : null}
        />
      )}

      {canWriteSchedules && <ScheduleForm orgId={orgId} listingId={listingId} vertical={org.vertical} />}

      <div className="mcard">
        <h2><Icon name="clock" size={18} />Occurrences</h2>
        {listing.schedules.length === 0 ? <p style={{ margin: 0, color: 'var(--tx-2)' }}>None scheduled yet.</p> : (
          listing.schedules.map((s) => (
            <div className="mrow" key={s.id}>
              <span className="k">{new Date(s.departAt).toLocaleString('en-KE')}</span>
              <span className="v">{s.status.toLowerCase()} · {s.bookingsCount} booking{s.bookingsCount === 1 ? '' : 's'}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
