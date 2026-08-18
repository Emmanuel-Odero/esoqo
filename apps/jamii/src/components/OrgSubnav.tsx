'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { orgHref, ORG_NAV_SECTIONS, type OrgLinkMode } from '@/lib/org-links-shared';

// usePathname() reflects the browser's own address bar, not
// middleware's internal rewrite target — a rewrite is transparent to
// the client — so it already reads e.g. "/about" on a custom domain
// and "/o/{slug}/about" on the primary domain, matching orgHref(mode)
// below with no extra translation needed.
export function OrgSubnav({ mode }: { mode: OrgLinkMode }) {
  const pathname = usePathname();

  return (
    <nav className="subnav">
      <div className="wrap subnav-inner">
        {ORG_NAV_SECTIONS.map(([key, label]) => {
          const href = orgHref(mode, key);
          const on = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={key} href={href} aria-current={on ? 'page' : undefined}>{label}</Link>
          );
        })}
      </div>
    </nav>
  );
}
