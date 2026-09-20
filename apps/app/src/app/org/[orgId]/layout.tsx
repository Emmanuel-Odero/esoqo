import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, Logo, type IconName } from '@esoqo/ui';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg } from '@/lib/ticketing';
import { OrgMobileNav } from './OrgMobileNav';
import '@/app/me/me.css';

export const metadata: Metadata = { title: { default: 'Organiser console', template: '%s · Esoqo' } };

/**
 * The org console — /org/[orgId] and everything beneath it.
 *
 * Reuses the /me dashboard's shell CSS (me.css) so an owner who opens
 * an organiser doesn't land in a visually different product. What's
 * NOT reused is ShellNav: this nav is capability-gated per tab (a
 * SCANNER session sees only "Scan tickets"), which /me's nav never
 * needs to do.
 *
 * Every link below is also independently re-checked in the DAL
 * (assertOwnsOrg on every dal/ticketing.ts call) — this gating is UX,
 * not the security boundary. See ADR-0003.
 */
export default async function OrgLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const { kind, ctx } = await requireOrgAccess(orgId);

  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();

  const tabs: { href: string; icon: IconName; label: string; show: boolean }[] = [
    { href: `/org/${orgId}`, icon: 'grid', label: 'Dashboard', show: true },
    // The fleet console is the transport-company manager's real product:
    // live map, dispatch and fares. Shown whenever the session holds
    // fleet.read — a MANAGER and an ADMIN both do, a SCANNER does not.
    // Each tab owns one icon: Fares uses "tag" (not "coins") so it can't
    // be mistaken for Bookings' money-in, and Listings keeps "calendar"
    // even for transport so it can't be mistaken for the Fleet truck.
    { href: `/org/${orgId}/fleet`, icon: 'truck', label: 'Fleet', show: org.vertical === 'TRANSPORT' && canOrg(ctx, org, 'fleet.read') },
    { href: `/org/${orgId}/fleet/pricing`, icon: 'tag', label: 'Fares', show: org.vertical === 'TRANSPORT' && canOrg(ctx, org, 'fleet.read') },
    // Luggage is gated on luggage.read, not fleet.read: a conductor's
    // CREW bundle carries the luggage grants without the fleet console's.
    { href: `/org/${orgId}/luggage`, icon: 'package', label: 'Luggage', show: org.vertical === 'TRANSPORT' && canOrg(ctx, org, 'luggage.read') },
    { href: `/org/${orgId}/listings`, icon: 'calendar', label: 'Listings', show: canOrg(ctx, org, 'listing.write') },
    { href: `/org/${orgId}/bookings`, icon: 'document', label: 'Bookings', show: canOrg(ctx, org, 'booking.read') },
    { href: `/org/${orgId}/scan`, icon: 'qr', label: 'Scan tickets', show: canOrg(ctx, org, 'ticket.checkin') },
    { href: `/org/${orgId}/staff`, icon: 'users', label: 'Staff', show: canOrg(ctx, org, 'ticketorgstaff.write') },
  ];

  return (
    <div className="me">
      <header className="appbar">
        <div className="appbar-in">
          <Link href={`/org/${orgId}`} className="appbrand" aria-label="Organiser console home">
            <Logo />
            <span className="appbar-name">
              {org.name}
              <small>{org.vertical === 'TRANSPORT' ? 'Transport organiser' : 'Events organiser'}</small>
            </span>
          </Link>
          {/* Desktop only (me.css hides .headnav under 820px) — the
              .orgnav strip below is the same links for phones, so every
              tab stays reachable on every subpage (Fleet, Scan, Staff…),
              not just the dashboard cards. */}
          <nav className="headnav" aria-label="Organiser console">
            {tabs.filter((t) => t.show).map((t) => (
              <Link key={t.href} href={t.href as never}>
                <Icon name={t.icon} size={17} />{t.label}
              </Link>
            ))}
          </nav>
          {kind === 'owner' ? (
            <Link href="/me/organiser" className="btn btn-o btn-sm">
              <Icon name="arrow-left" size={15} />Your organisers
            </Link>
          ) : (
            <form action="/org-staff/signout" method="post">
              <button type="submit" className="btn btn-o btn-sm">
                <Icon name="close" size={15} />Sign out
              </button>
            </form>
          )}
          {/* Phones: the same tabs as .headnav above, swipeable. Rendered
              always, shown only under 820px by me.css (.orgnav). */}
          <OrgMobileNav tabs={tabs} orgId={orgId} />
        </div>
      </header>
      <div className="wrap">{children}</div>
    </div>
  );
}
