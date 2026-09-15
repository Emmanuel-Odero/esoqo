import Link from 'next/link';
import type { Route } from 'next';
import { Icon, type IconName } from '@esoqo/ui';

/** Sub-nav for one organiser's console — Overview plus whichever
 *  management tabs the signed-in staff member can act on. Mirrors the
 *  org-owner's own /org/[orgId] shell, just staff-facing and gated by
 *  capability instead of ownership. */
export function OrgTabs({
  orgId, active, tabs,
}: {
  orgId: string;
  active: 'overview' | 'routes' | 'listings' | 'bookings';
  tabs: { routes: boolean; listings: boolean; bookings: boolean };
}) {
  const items: { key: typeof active; label: string; icon: IconName; href: Route; show: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: 'tag', href: `/ticketing/${orgId}` as Route, show: true },
    { key: 'routes', label: 'Venues & routes', icon: 'map', href: `/ticketing/${orgId}/routes` as Route, show: tabs.routes },
    { key: 'listings', label: 'Listings & schedules', icon: 'calendar', href: `/ticketing/${orgId}/listings` as Route, show: tabs.listings },
    { key: 'bookings', label: 'Bookings', icon: 'coins', href: `/ticketing/${orgId}/bookings` as Route, show: tabs.bookings },
  ];

  return (
    <nav className="tabnav" aria-label="Organiser sections">
      {items.filter((i) => i.show).map((i) => (
        <Link key={i.key} href={i.href} className={`tabnav-item${i.key === active ? ' active' : ''}`}
          aria-current={i.key === active ? 'page' : undefined}>
          <Icon name={i.icon} size={14} />{i.label}
        </Link>
      ))}
    </nav>
  );
}
