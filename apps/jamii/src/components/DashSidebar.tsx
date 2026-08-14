'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  ['/dashboard', 'Overview'],
  ['/dashboard/posts', 'Posts'],
  ['/dashboard/campaigns', 'Campaigns'],
  ['/dashboard/gallery', 'Gallery'],
  ['/dashboard/donors', 'Donors'],
  ['/dashboard/team', 'Team'],
  ['/dashboard/settings', 'Settings'],
] as const;

export function DashSidebar({ orgName, slug }: { orgName: string; slug: string }) {
  const pathname = usePathname();
  return (
    <aside className="dashside">
      <div className="dash-orginfo">
        <b>{orgName}</b>
        <span>ourjamii.co.ke/o/{slug}</span>
      </div>
      <ul className="dashmenu">
        {ITEMS.map(([href, label]) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
