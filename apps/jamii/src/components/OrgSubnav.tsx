'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { orgHref, ORG_NAV_SECTIONS, type OrgLinkMode, type ResolvedNavLink } from '@/lib/org-links-shared';

// usePathname() reflects the browser's own address bar, not
// middleware's internal rewrite target — a rewrite is transparent to
// the client — so it already reads e.g. "/about" on a custom domain
// and "/o/{slug}/about" on the primary domain, matching orgHref(mode)
// below with no extra translation needed.
export function OrgSubnav({ mode, navLinks }: { mode: OrgLinkMode; navLinks: ResolvedNavLink[] }) {
  const pathname = usePathname();

  const links = navLinks.length > 0
    ? navLinks
    : ORG_NAV_SECTIONS.map(([key, label]) => ({ key, label, href: orgHref(mode, key), external: false, newTab: false }));

  // The org root (the shortest internal href) matches exactly; without
  // this every section under it would also light up "Home", since every
  // section path starts with the root path.
  const base = links
    .filter((l) => !l.external)
    .reduce((shortest, l) => (l.href.length < shortest.length ? l.href : shortest), links[0]?.href ?? '');

  return (
    <nav className="subnav">
      <div className="wrap subnav-inner">
        {links.map((l) => {
          if (l.external) {
            return (
              <a key={l.key} href={l.href} target={l.newTab ? '_blank' : undefined} rel={l.newTab ? 'noreferrer' : undefined}>
                {l.label}
              </a>
            );
          }
          const on = pathname === l.href || (l.href !== base && pathname.startsWith(`${l.href}/`));
          return (
            <Link key={l.key} href={l.href as Route} aria-current={on ? 'page' : undefined}>{l.label}</Link>
          );
        })}
      </div>
    </nav>
  );
}
