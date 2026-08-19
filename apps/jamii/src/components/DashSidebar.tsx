'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  ['/dashboard', 'Overview'],
  ['/dashboard/posts', 'Posts'],
  ['/dashboard/programs', 'Programmes'],
  ['/dashboard/campaigns', 'Campaigns'],
  ['/dashboard/gallery', 'Gallery'],
  ['/dashboard/messages', 'Messages'],
  ['/dashboard/donors', 'Donors'],
  ['/dashboard/team', 'Team'],
  ['/dashboard/settings', 'Settings'],
] as const;

export function DashSidebar({ orgName, slug, newMessageCount = 0 }: { orgName: string; slug: string; newMessageCount?: number }) {
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
            <Link href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
              {href === '/dashboard/messages' && newMessageCount > 0 && (
                <span className="dash-badge">{newMessageCount}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
