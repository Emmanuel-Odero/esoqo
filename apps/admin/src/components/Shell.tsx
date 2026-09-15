'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';
import { ScanBox } from './ScanBox';

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
    ['/sectors', 'trend-up', 'Sectors', 'report.read'],
  ]},
  { group: 'eStores', items: [
    ['/estores', 'chart', 'Overview', 'store.read'],
    ['/estores/orders', 'basket', 'Orders', 'order.read'],
    ['/estores/products', 'grid', 'Products', 'store.read'],
    ['/estores/stores', 'shop', 'Stores', 'store.read'],
    ['/estores/traders', 'user', 'Users & traders', 'store.read'],
    ['/estores/pricing', 'coins', 'Resource pricing', 'pricing.read'],
    ['/estores/settings', 'key', 'Settings', 'store.read'],
  ]},
  { group: 'Ticketing', items: [
    ['/ticketing', 'tag', 'Organisers', 'ticketorg.read'],
    ['/fraud', 'shield', 'Fare fraud', 'ticketorg.read'],
    ['/vouchers', 'coins', 'Vouchers', 'ticketorg.read'],
  ]},
  { group: 'Parcels', items: [
    ['/parcels', 'basket', 'Parcels', 'parcels.read'],
    ['/parcels/counter', 'plus', 'Counter', 'parcels.assign'],
    ['/parcels/live', 'trend-up', 'Live dispatch', 'parcels.read'],
    ['/parcels/companies', 'building', 'Courier companies', 'parcels.read'],
    ['/parcels/cod', 'coins', 'Cash on delivery', 'parcels.read'],
    ['/parcels/payouts', 'bank', 'Courier payouts', 'parcels.read'],
    ['/parcels/couriers', 'users', 'Couriers', 'parcels.couriers.manage'],
    ['/parcels/teams', 'truck', 'Courier teams', 'parcels.couriers.manage'],
    ['/parcels/labels', 'qr', 'Blank labels', 'parcels.assign'],
    ['/parcels/pricing', 'coins', 'Pricing', 'parcel_pricing.write'],
  ]},
  { group: 'Our Jamii', items: [
    ['/jamii-overview', 'chart', 'Overview', 'jamii-page.read'],
    ['/jamii-pages', 'handshake', 'Pages', 'jamii-page.read'],
    ['/jamii-campaigns', 'trend-up', 'Campaigns', 'jamii-campaign.read'],
    ['/jamii-donations', 'coins', 'Donations', 'jamii-donation.read'],
    ['/jamii-interest', 'users', 'Interest', 'jamii-interest.read'],
    ['/jamii-media', 'grid', 'Media library', 'jamii-media.manage'],
  ]},
  { group: 'Governance', items: [
    ['/staff', 'shield', 'Staff & permissions', 'staff.read'],
    ['/audit', 'scales', 'Audit log', 'audit.read'],
    ['/support-tickets', 'message', 'Support tickets', 'support-ticket.read'],
  ]},
];

const NAV_STORAGE_KEY = 'esoko-admin-nav-collapsed';

function allowed(caps: string[], need: string) {
  return caps.includes('*') || caps.some((c) => c === need || c.startsWith(`${need.split('.')[0]}.`));
}

/** A nav item is "active" for its own page and every page nested under
 *  it (e.g. /estores/stores/abc123 keeps "Stores" lit), not just an
 *  exact path match. */
function isActive(path: string, href: string) {
  return path === href || (href !== '/' && path.startsWith(`${href}/`));
}

interface NavDrillIn { parentHref: string; label: string }
const NavDrillInContext = createContext<(v: NavDrillIn | null) => void>(() => {});

/**
 * Lets a detail page (a single store, eventually a single group) name
 * itself in the sidebar while it's open — called from that page's own
 * client component. Clears automatically on unmount, so navigating
 * away removes it without any route-matching logic here having to know
 * what a "store" is.
 */
export function useNavDrillIn(parentHref: string, label: string | null) {
  const setDrillIn = useContext(NavDrillInContext);
  useEffect(() => {
    if (!label) return undefined;
    setDrillIn({ parentHref, label });
    return () => setDrillIn(null);
  }, [parentHref, label, setDrillIn]);
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [drillIn, setDrillIn] = useState<NavDrillIn | null>(null);

  // A route change is the clearest sign the user picked something —
  // close the drawer so the new page isn't hidden behind it.
  useEffect(() => { setNavOpen(false); }, [path]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  // Collapse state is per-browser, not per-page-load — read once on
  // mount so a section someone closed stays closed across navigations
  // and reloads, without server/client markup mismatching on first paint.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch { /* localStorage unavailable — fall back to all-open */ }
    setHydrated(true);
  }, []);

  function toggleGroup(group: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try { localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const isSuper = capabilities.includes('*');

  // Several hrefs can nest-match the same path (e.g. both "/estores" and
  // "/estores/stores" are prefixes of "/estores/stores/abc") — only the
  // most specific one should actually light up.
  const activeHref = NAV.flatMap((g) => g.items.map(([href]) => href))
    .filter((href) => isActive(path, href))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <div className="shell">
      <aside id="nav" aria-label="Sections" className={navOpen ? 'nav-open' : ''}>
        <div className="brand">
          <span className="brand-mark"><Icon name="chart" size={17} /></span>
          <div>
            <strong>Esoqo</strong>
            <span>Operations</span>
          </div>
          <button type="button" className="nav-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className={hydrated ? 'ready' : undefined}>
          {NAV.map((g) => {
            const items = g.items.filter(([, , , cap]) => allowed(capabilities, cap));
            if (!items.length) return null;
            const hasActive = items.some(([href]) => href === activeHref);
            const isCollapsed = Boolean(collapsed[g.group]) && !hasActive;
            return (
              <div key={g.group} className="navsection">
                <button type="button" className="navgroup" aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(g.group)}>
                  {g.group}
                  <span className={`navgroup-chev${isCollapsed ? ' closed' : ''}`}>
                    <Icon name="chevron-down" size={13} />
                  </span>
                </button>
                <div className={`navitems${isCollapsed ? ' collapsed' : ''}`}>
                  <div className="navitems-inner">
                    {items.map(([href, icon, label]) => (
                      <div key={href}>
                        <Link href={href as Route} className={href === activeHref ? 'on' : ''}
                          aria-current={href === activeHref ? 'page' : undefined} onClick={() => setNavOpen(false)}>
                          <Icon name={icon} size={17} />{label}
                        </Link>
                        {drillIn?.parentHref === href && (
                          <span className="nav-drillin">
                            <Icon name="chevron-right" size={12} />{drillIn.label}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
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
            {/* Gated on the same capability the parcels section is —
                the scanner's only destinations are parcel screens, so
                offering it to someone who can't open them would be the
                "door they cannot open" this file's NAV comment warns
                about. */}
            {allowed(capabilities, 'parcels.read') && <ScanBox />}
            <Link href={'/set-pin' as Route} className="avatar" title="Change your PIN">
              {(actorId ?? 'OP').slice(0, 2).toUpperCase()}
            </Link>
            <span className="sr-only">Signed in</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <NavDrillInContext.Provider value={setDrillIn}>{children}</NavDrillInContext.Provider>
        </main>
      </div>
    </div>
  );
}
