'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: IconName;
}

/**
 * The sub-nav inside Settings.
 *
 * Client-side only for the active state, same split as ParcelOrgNav:
 * the server layout knows the capabilities and builds the item list,
 * but only the browser knows the current path.
 *
 * A section is listed only when the session can actually open it, so
 * the list is never a set of doors that answer with a redirect.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="porgset-nav" aria-label="Settings sections">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
