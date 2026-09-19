import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';
import { AuthorisationError } from '@esoqo/db';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg, type GoListing, type GoOrgBooking } from '@/lib/ticketing';

export const dynamic = 'force-dynamic';

export default async function OrgDashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  // Console reads come from core-go (dbx.AssertOwnsOrg enforces); the
  // TS session ctx above is only for nav gating via canOrg.
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();

  const canListings = canOrg(ctx, org, 'listing.write');
  const canBookings = canOrg(ctx, org, 'booking.read');
  const canScan = canOrg(ctx, org, 'ticket.checkin');
  const canStaff = canOrg(ctx, org, 'ticketorgstaff.write');
  const canFleet = org.vertical === 'TRANSPORT' && canOrg(ctx, org, 'fleet.read');

  const [listings, bookings] = await Promise.all([
    canListings
      ? orgGo<{ listings: GoListing[] | null }>(orgId, `/v1/ticketorgs/${orgId}/listings`)
          .then((r) => r.listings ?? [])
          .catch((e) => {
            if (e instanceof AuthorisationError) notFound();
            throw e;
          })
      : Promise.resolve([]),
    canBookings
      ? orgGo<{ bookings: GoOrgBooking[] | null }>(orgId, `/v1/ticketorgs/${orgId}/bookings`)
          .then((r) => r.bookings ?? [])
          .catch((e) => {
            if (e instanceof AuthorisationError) notFound();
            throw e;
          })
      : Promise.resolve([]),
  ]);

  const published = listings.filter((l) => l.status === 'PUBLISHED').length;
  const upcoming = listings
    .flatMap((l) => l.schedules)
    .filter((s) => new Date(s.departAt) > new Date() && s.status === 'SCHEDULED').length;
  const paidBookings = bookings.filter((b) => b.status === 'PAID').length;
  const revenueKes = bookings.filter((b) => b.status === 'PAID').reduce((sum, b) => sum + Number(b.totalKes), 0);

  const cards: { href: string; icon: IconName; title: string; body: string; show: boolean }[] = [
    { href: `/org/${orgId}/fleet`, icon: 'truck',
      title: 'Fleet', body: 'Live map, dispatch and today’s cash-up', show: canFleet },
    { href: `/org/${orgId}/fleet/pricing`, icon: 'tag',
      title: 'Fares', body: 'Fares per stage along each route', show: canFleet },
    { href: `/org/${orgId}/listings`, icon: 'calendar',
      title: 'Listings', body: `${listings.length} total, ${published} published`, show: canListings },
    { href: `/org/${orgId}/bookings`, icon: 'document',
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
