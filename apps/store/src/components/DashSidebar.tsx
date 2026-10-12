'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';

const NAV: [string, IconName, string][] = [
  ['/dashboard', 'chart', 'Overview'],
  ['/dashboard/products', 'box', 'Products'],
  ['/dashboard/stock', 'truck', 'Stock & suppliers'],
  ['/dashboard/orders', 'basket', 'Orders'],
  ['/dashboard/receipts', 'print', 'Receipts'],
  ['/dashboard/pos', 'keypad', 'PoS terminal'],
  ['/dashboard/shifts', 'clock', 'Shifts'],
  ['/dashboard/cashiers', 'key', 'Cashiers'],
  ['/dashboard/customers', 'users', 'Customers'],
  ['/dashboard/debts', 'coins', 'Debts'],
  ['/dashboard/reports', 'chart', 'Reports'],
  ['/dashboard/settings', 'shop', 'Store settings'],
  ['/dashboard/settings/profile', 'star', 'Store profile'],
];

export function DashSidebar({ store }: { store: { name: string; slug: string } | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Longest matching prefix wins, so /dashboard/settings/profile marks
  // "Store profile" rather than both it and its "Store settings" parent,
  // and a detail route like /dashboard/orders/123 still marks "Orders".
  const activeHref = NAV.map(([href]) => href)
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('esoqo:nav-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('esoqo:nav-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('esoqo:nav-state', { detail: { open } }));
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <div className={`nav-backdrop${open ? ' nav-open' : ''}`} aria-hidden="true" onClick={() => setOpen(false)} />
      <aside id="dash-side" className={`dash-side${open ? ' nav-open' : ''}`}>
        <div className="dash-side-top">
          <div className="dash-store">
            <span className="mk">{(store?.name ?? 'ES').slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{store?.name ?? 'Your store'}</strong>
              <span>{store ? `esoqo.com/@${store.slug}` : 'Not opened yet'}</span>
            </div>
          </div>
          <button type="button" className="nav-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <Icon name="close" size={16} />
          </button>
        </div>
        <nav className="dash-nav" aria-label="Dashboard navigation">
          {NAV.map(([href, icon, label]) => (
            <Link key={href} href={href as Route} aria-current={href === activeHref ? 'page' : undefined}>
              <span className="nav-icon"><Icon name={icon} size={15} /></span>{label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}