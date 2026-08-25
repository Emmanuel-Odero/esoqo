import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getTicketOrg, listTicketOrgStaff, listOrgBookings, can, AuthorisationError } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { OrgStaffPanel } from './OrgStaffPanel';
import { OrgTabs } from './OrgTabs';

export const dynamic = 'force-dynamic';

const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };
const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

export default async function TicketOrgDetail({
  params,
}: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const canManageStaff = ctx.capabilities.includes('*') || ctx.capabilities.includes('ticketorgstaff.write');

  const org = await getTicketOrg(ctx, id).catch((e) => {
    if (e instanceof AuthorisationError) notFound();
    throw e;
  });
  const staff = canManageStaff
    ? await listTicketOrgStaff(ctx, id)
    : [];

  const canReadBookings = can(ctx, 'booking.read', { partyId: org.enterprise?.partyId });
  const canManageListings = can(ctx, 'listing.write', { partyId: org.enterprise?.partyId });
  const canManageRoutes = can(ctx, 'venue.write', { partyId: org.enterprise?.partyId })
    || can(ctx, 'route.write', { partyId: org.enterprise?.partyId });
  const bookings = canReadBookings ? await listOrgBookings(ctx, id) : [];
  const paid = bookings.filter((b) => b.status === 'PAID');
  const revenueKes = paid.reduce((n, b) => n + Number(b.totalKes), 0);
  const ticketsIssued = paid.reduce(
    (n, b) => n + b.tickets.filter((t) => t.status === 'VALID' || t.status === 'USED').length, 0,
  );
  const cancelled = bookings.filter((b) => b.status === 'CANCELLED' || b.status === 'REFUNDED').length;

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
            {org.contactPerson && <> · {org.contactPerson}</>}
            {org.contactPhone && <> ({org.contactPhone})</>}
          </p>
        </div>
      </div>

      <OrgTabs orgId={id} active="overview" tabs={{ routes: canManageRoutes, listings: canManageListings, bookings: canReadBookings }} />

      {canReadBookings && (
        <div className="kpis">
          <div className="kpi g">
            <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="coins" size={16} /></span>
            <span className="n">KES {revenueKes.toLocaleString('en-KE')}</span><span className="l">Revenue, paid bookings</span>
          </div>
          <div className="kpi b">
            <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="certificate" size={16} /></span>
            <span className="n">{ticketsIssued}</span><span className="l">Tickets issued</span>
          </div>
          <div className="kpi">
            <span className="n">{bookings.length}</span><span className="l">Bookings total</span>
          </div>
          <div className={`kpi ${cancelled > 0 ? 'r' : ''}`}>
            <span className="n" style={{ color: cancelled > 0 ? 'var(--red)' : undefined }}>{cancelled}</span>
            <span className="l">Cancelled / refunded</span>
          </div>
        </div>
      )}

      {canManageStaff ? (
        <OrgStaffPanel orgId={id} staff={staff.map((s) => ({
          id: s.id, name: s.name, role: s.role, active: s.active,
        }))} />
      ) : (
        <div className="card">
          <p className="empty">You need <code>ticketorgstaff.write</code> to add or manage this organiser&rsquo;s staff.</p>
        </div>
      )}
    </>
  );
}
