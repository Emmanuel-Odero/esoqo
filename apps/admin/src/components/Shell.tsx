'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoko/ui';

/**
 * Navigation renders from CAPABILITIES, not from a role name.
 *
 * A finance approver never sees the staff section; a viewer never sees
 * the payment queue. Hiding is a courtesy — the DAL is what actually
 * refuses — but showing someone a door they cannot open is bad design.
 */
const NAV: { group: string; items: [string, IconName, string, string][] }[] = [
  { group: 'Work', items: [
    ['/', 'chart', 'Overview', 'report.read'],
    ['/registrations', 'users', 'Registrations', 'registration.read'],
    ['/payments', 'coins', 'Payments', 'payment.read'],
    ['/documents', 'document', 'Documents', 'document.read'],
    ['/groups', 'handshake', 'Groups', 'party.read'],
    ['/stores', 'shop', 'Stores & pricing', 'store.read'],
    ['/sectors', 'trend-up', 'Sectors', 'report.read'],
  ]},
  { group: 'Governance', items: [
    ['/staff', 'shield', 'Staff & permissions', 'staff.read'],
    ['/audit', 'scales', 'Audit log', 'audit.read'],
  ]},
];

function allowed(caps: string[], need: string) {
  return caps.includes('*') || caps.some((c) => c === need || c.startsWith(`${need.split('.')[0]}.`));
}

/**
 * Wraps the sidebar, topbar and page content, and owns the one bit of
 * state that ties them together: whether the mobile nav drawer is open.
 * A single client component because that state has to be shared between
 * the hamburger button (in the topbar) and the drawer it opens (the
 * sidebar) — two visually separate pieces with no other reason to
 * know about each other.
 */
export function DashboardShell({
  capabilities, actorId, children,
}: { capabilities: string[]; actorId: string | null; children: React.ReactNode }) {
  const path = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // A route change is the clearest sign the user picked something —
  // close the drawer so the new page isn't hidden behind it.
  useEffect(() => { setNavOpen(false); }, [path]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  const isSuper = capabilities.includes('*');

  return (
    <div className="shell">
      <aside id="nav" aria-label="Sections" className={navOpen ? 'nav-open' : ''}>
        <div className="brand">
          <span className="brand-mark"><Icon name="chart" size={17} /></span>
          <div>
            <strong>Esoko</strong>
            <span>Operations</span>
          </div>
          <button type="button" className="nav-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter(([, , , cap]) => allowed(capabilities, cap));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <p className="navgroup">{g.group}</p>
                {items.map(([href, icon, label]) => (
                  <Link key={href} href={href as Route} className={path === href ? 'on' : ''}
                    aria-current={path === href ? 'page' : undefined} onClick={() => setNavOpen(false)}>
                    <Icon name={icon} size={17} />{label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <p className="env">Pilot build</p>
      </aside>

      {navOpen && (
        <button type="button" className="nav-backdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      )}

      <div className="col">
        <header className="topbar">
          <button type="button" className="nav-toggle-btn" onClick={() => setNavOpen(true)}
            aria-label="Open menu" aria-expanded={navOpen} aria-controls="nav">
            <Icon name="menu" size={20} />
          </button>
          <div className="tb-caps" title={`${capabilities.length} capabilities`}>
            <Icon name="key" size={14} />
            {isSuper ? 'Super admin' : `${capabilities.length} permissions`}
          </div>
          <div className="tb-right">
            <span className="avatar" aria-hidden="true">
              {(actorId ?? 'OP').slice(0, 2).toUpperCase()}
            </span>
            <span className="sr-only">Signed in</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
