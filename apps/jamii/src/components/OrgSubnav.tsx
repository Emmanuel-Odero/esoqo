'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  ['about', 'About'],
  ['programs', 'Programs'],
  ['campaigns', 'Campaigns'],
  ['posts', 'Posts'],
  ['gallery', 'Gallery'],
  ['leadership', 'Leadership'],
  ['faq', 'FAQ'],
  ['contact', 'Contact'],
] as const;

export function OrgSubnav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="subnav">
      <div className="wrap subnav-inner">
        {SECTIONS.map(([key, label]) => {
          const href = `/o/${slug}/${key}`;
          const on = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={key} href={href as Route} aria-current={on ? 'page' : undefined}>{label}</Link>
          );
        })}
      </div>
    </nav>
  );
}
