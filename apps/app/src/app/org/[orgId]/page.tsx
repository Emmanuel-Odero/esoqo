import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, type IconName } from '@esoko/ui';
import { getTicketOrg, listOrgListings, listOrgBookings } from '@esoko/db';
import { requireOrgAccess } from '@/lib/session';
import { canOrg } from '@/lib/ticketing';

export const dynamic = 'force-dynamic';

export default async function OrgDashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await getTicketOrg(ctx, orgId).catch(() => null);
  if (!org) notFound();

  const canListings = canOrg(ctx, org, 'listing.write');
  const canBookings = canOrg(ctx, org, 'booking.read');
  const canScan = canOrg(ctx, org, 'ticket.checkin');
  const canStaff = canOrg(ctx, org, 'ticketorgstaff.write');

  const [listings, bookings] = await Promise.all([
    canListings ? listOrgListings(ctx, orgId) : Promise.resolve([]),
    canBookings ? listOrgBookings(ctx, orgId) : Promise.resolve([]),
  ]);

  const published = listings.filter((l) => l.status === 'PUBLISHED').length;
  const upcoming = listings.flatMap((l) => l.schedules).filter((s) => s.departAt > new Date() && s.status === 'SCHEDULED').length;
  const paidBookings = bookings.filter((b) => b.status === 'PAID').length;
  const revenueKes = bookings.filter((b) => b.status === 'PAID').reduce((sum, b) => sum + Number(b.totalKes), 0);

  const cards: { href: string; icon: IconName; title: string; body: string; show: boolean }[] = [
    { href: `/org/${orgId}/listings`, icon: org.vertical === 'TRANSPORT' ? 'truck' : 'calendar',
      title: 'Listings', body: `${listings.length} total, ${published} published`, show: canListings },
    { href: `/org/${orgId}/bookings`, icon: 'coins',
      title: 'Bookings', body: `${bookings.length} total, ${paidBookings} paid`, show: canBookings },
    { href: `/org/${orgId}/scan`, icon: 'qr',
      title: 'Scan tickets', body: 'Check people in at the gate', show: canScan },
    { href: `/org/${orgId}/staff`, icon: 'users',
      title: 'Staff', body: 'Admins, managers and gate scanners', show: canStaff },
  ];

  return (
    <>
      <div className="mehead">
        <h1>{org.name}</h1>
        <p>{org.vertical === 'TRANSPORT' ? 'Transport organiser' : 'Events organiser'} · {org.status.toLowerCase()}</p>
      </div>

      {canBookings && (
        <div className="mcard" style={{ marginBottom: 16 }}>
          <h2><Icon name="chart" size={18} />At a glance</h2>
          <div className="mrow"><span className="k">Upcoming occurrences</span><span className="v">{upcoming}</span></div>
          <div className="mrow"><span className="k">Paid bookings</span><span className="v">{paidBookings}</span></div>
          <div className="mrow"><span className="k">Revenue collected</span>
            <span className="v mono">KES {revenueKes.toLocaleString('en-KE')}</span></div>
        </div>
      )}

      <div className="dash-cols" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {cards.filter((c) => c.show).map((c) => (
          <Link key={c.href} href={c.href as never} className="mcard" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <h2><Icon name={c.icon} size={18} />{c.title}</h2>
            <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: '.9rem' }}>{c.body}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
