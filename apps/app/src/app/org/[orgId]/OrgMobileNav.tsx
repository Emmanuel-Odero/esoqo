'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';

export interface OrgNavTab {
  href: string;
  icon: IconName;
  label: string;
  show: boolean;
}

/**
 * The organiser console's phone nav — the same capability-gated tabs as
 * the desktop .headnav, one swipeable row. Rendered always, shown only
 * under 820px (.orgnav in me.css). Client-side only for the active
 * state: only the browser knows the current path.
 *
 * The dashboard href is the prefix of every other tab's route, so it
 * gets an exact match while every other tab matches its own subtree.
 */
export function OrgMobileNav({ tabs, orgId }: { tabs: OrgNavTab[]; orgId: string }) {
  const pathname = usePathname();
  const home = `/org/${orgId}`;
  const isActive = (href: string) =>
    href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const visible = tabs.filter((t) => t.show);
  if (visible.length === 0) return null;

  return (
    <nav className="orgnav" aria-label="Organiser console">
      {visible.map((t) => (
        <Link key={t.href} href={t.href as never} aria-current={isActive(t.href) ? 'page' : undefined}>
          <Icon name={t.icon} size={17} />{t.label}
        </Link>
      ))}
    </nav>
  );
}
