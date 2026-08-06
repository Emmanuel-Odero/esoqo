'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoko/ui';

const NAV: [string, IconName, string][] = [
  ['/dashboard', 'chart', 'Overview'],
  ['/dashboard/products', 'box', 'Products'],
  ['/dashboard/orders', 'basket', 'Orders'],
  ['/dashboard/pos', 'keypad', 'PoS terminal'],
  ['/dashboard/settings', 'shop', 'Store settings'],
];

export function DashSidebar({ store }: { store: { name: string; slug: string } | null }) {
  const path = usePathname();
  return (
    <aside className="dash-side">
      <div className="dash-store">
        <span className="mk">{(store?.name ?? 'ES').slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{store?.name ?? 'Your store'}</strong>
          <span>{store ? `esoko.global/@${store.slug}` : 'Not opened yet'}</span>
        </div>
      </div>
      <nav className="dash-nav" aria-label="Dashboard navigation">
        {NAV.map(([href, icon, label]) => (
          <Link key={href} href={href as Route} aria-current={path === href ? 'page' : undefined}>
            <span className="nav-icon"><Icon name={icon} size={15} /></span>{label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}