'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon } from '@esoko/ui';

const ITEMS_BEFORE_PAGES = [
  ['/dashboard', 'Overview'],
  ['/dashboard/homepage', 'Homepage'],
] as const;

const ITEMS_AFTER_PAGES = [
  ['/dashboard/navigation', 'Navigation'],
  ['/dashboard/posts', 'Posts'],
  ['/dashboard/programs', 'Programmes'],
  ['/dashboard/campaigns', 'Campaigns'],
  ['/dashboard/leadership', 'Leadership'],
  ['/dashboard/gallery', 'Gallery'],
  ['/dashboard/messages', 'Messages'],
  ['/dashboard/donors', 'Donors'],
  ['/dashboard/team', 'Team'],
  ['/dashboard/support', 'Support'],
  ['/dashboard/settings', 'Settings'],
] as const;

export function DashSidebar({
  orgName, slug, newMessageCount = 0, pages,
}: {
  orgName: string;
  slug: string;
  newMessageCount?: number;
  /** Every JamiiSitePage — built-in sections first, then custom pages
   *  (see listJamiiSitePagesForDashboard) — nested under "Pages" so the
   *  sidebar doesn't need a separate top-level row per page. */
  pages: { id: string; title: string }[];
}) {
  const pathname = usePathname();
  const onPagesScreen = pathname === '/dashboard/pages' || pathname.startsWith('/dashboard/pages/');
  // Starts expanded when a page's own editor (or the list itself) is
  // the current screen, so landing on /dashboard/pages/[id] straight
  // from a link elsewhere shows where you are. Re-expands on every
  // fresh arrival at a pages screen (the effect below), but a manual
  // collapse while already there is respected — it doesn't snap back
  // open on its own.
  const [open, setOpen] = useState(onPagesScreen);
  useEffect(() => { if (onPagesScreen) setOpen(true); }, [onPagesScreen]);

  return (
    <aside className="dashside">
      <div className="dash-orginfo">
        <b>{orgName}</b>
        <span>ourjamii.co.ke/o/{slug}</span>
      </div>
      <ul className="dashmenu">
        {ITEMS_BEFORE_PAGES.map(([href, label]) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>
          </li>
        ))}

        <li>
          <div className="dashmenu-row">
            <Link href="/dashboard/pages" aria-current={pathname === '/dashboard/pages' ? 'page' : undefined}>
              Pages
            </Link>
            <button
              type="button"
              className="dashmenu-toggle"
              aria-expanded={open}
              aria-label={open ? 'Collapse pages list' : 'Expand pages list'}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
            </button>
          </div>
          {open && (
            <ul className="dashsubmenu">
              {pages.map((p) => {
                const href = `/dashboard/pages/${p.id}` as Route;
                return (
                  <li key={p.id}>
                    <Link href={href} aria-current={pathname === href ? 'page' : undefined}>{p.title}</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        {ITEMS_AFTER_PAGES.map(([href, label]) => (
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
