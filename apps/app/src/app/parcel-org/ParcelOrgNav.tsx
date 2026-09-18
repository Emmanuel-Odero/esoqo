'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';

export interface ParcelOrgNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
}

/**
 * The courier portal's main nav.
 *
 * Client-side only for the active state: the server layout knows the
 * capabilities and builds the item list, but only the browser knows the
 * current path, and the old server-only links never set aria-current —
 * so no tab ever looked selected. On phones this becomes a single
 * horizontally-scrollable strip (see parcel-org.css) instead of the
 * wrapped multi-row block it used to collapse into.
 */
export function ParcelOrgNav({ items }: { items: ParcelOrgNavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/parcel-org' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="porgnav" aria-label="Main">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href as Route}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          <Icon name={item.icon} size={17} />
          <span>{item.label}</span>
          {item.badge ? <span className="porgnav-badge">{item.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
