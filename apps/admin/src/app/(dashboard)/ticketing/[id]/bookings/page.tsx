import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getTicketOrg, listOrgBookings, can, AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { OrgTabs } from '../OrgTabs';
import { BookingsPanel } from './BookingsPanel';

export const dynamic = 'force-dynamic';

const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };
const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

/** Every checkout made against this organiser's listings — search,
 *  drill into a buyer, and cancel one from admin when support needs to
 *  act on the organiser's behalf. The overview tab keeps the aggregate
 *  KPIs; this is the working list. */
export default async function OrgBookingsPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;

  const org = await getTicketOrg(ctx, id).catch((e) => {
    if (e instanceof AuthorisationError) notFound();
    throw e;
  });

  if (!can(ctx, 'booking.read', { partyId: org.enterprise?.partyId })) notFound();
  const canCancel = can(ctx, 'booking.cancel', { partyId: org.enterprise?.partyId });

  const bookings = await listOrgBookings(ctx, id);

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

      <OrgTabs orgId={id} active="bookings" tabs={{ routes: true, listings: true, bookings: true }} />

      <BookingsPanel
        orgId={id}
        canCancel={canCancel}
        bookings={bookings.map((b) => ({
          id: b.id,
          listingTitle: b.schedule.listing.title,
          buyerName: b.buyerName,
          buyerMsisdn: b.buyerMsisdn,
          status: b.status,
          paymentMethod: b.paymentMethod,
          totalKes: Number(b.totalKes),
          ticketCount: b.tickets.length,
          checkedInCount: b.tickets.filter((t) => t.status === 'USED').length,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
