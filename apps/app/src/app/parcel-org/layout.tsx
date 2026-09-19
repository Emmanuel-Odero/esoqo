import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, Logo } from '@esoqo/ui';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { ParcelOrgNav, type ParcelOrgNavItem } from './ParcelOrgNav';
import { DemoBanner } from './DemoBanner';
import './parcel-org.css';

export const metadata: Metadata = { title: { default: 'Your parcels', template: '%s · Esoqo' } };

/**
 * Shared chrome for the courier-company portal — every page under
 * /parcel-org used to render with no header at all (no logo, no company
 * name, no nav — see parcel-org.css's own comment on why), each one
 * repeating its own ad hoc "Back to parcels" link instead. This is the
 * one bar every one of those pages now sits under.
 *
 * Deliberately tolerant of a dead session: getParcelOrgMe() is called
 * again here (each child page already calls it for its own data, same
 * "layout re-fetches for chrome, page fetches for content" split
 * /me/layout.tsx follows), but a failure here never redirects — that's
 * still each page's own job (see e.g. the counter page's own try/catch
 * to /parcel-org/signed-out). A layout-level redirect would loop: this
 * layout also wraps /parcel-org/signed-out itself, which by definition
 * has no session to show a company name for. An unauthenticated render
 * just renders children with no porg chrome around them, and the child
 * page's own redirect fires on the next paint.
 */
export default async function ParcelOrgLayout({ children }: { children: React.ReactNode }) {
  const me = await getParcelOrgMe().catch((e) => {
    if (e instanceof ParcelOrgUnauthorised) return null;
    throw e;
  });

  if (!me) return <>{children}</>;

  const canManageStaff = me.capabilities.includes('parcelorgstaff.write');
  const canManagePricing = me.capabilities.includes('parcelorg.write');
  const canManageStations = me.capabilities.includes('parcelorgstation.write');
  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  // The counter page carries both jobs now — booking (dispatch) and the
  // front-desk worklist (carry) — so anyone with either capability gets
  // the one nav entry.
  const canDesk = canDispatch || me.capabilities.includes('parcelorg.carry');

  const nav: ParcelOrgNavItem[] = [
    { href: '/parcel-org', label: 'Parcels', icon: 'box' },
    ...(canDispatch ? [{ href: '/parcel-org/dispatch', label: 'Dispatch', icon: 'send' as const }] : []),
    ...(canDesk ? [{ href: '/parcel-org/counter', label: 'Counter', icon: 'plus' as const, badge: me.stats.awaitingDropoff || undefined }] : []),
    ...(canManagePricing ? [{ href: '/parcel-org/pricing', label: 'Pricing', icon: 'coins' as const }] : []),
    ...(canManageStations ? [{ href: '/parcel-org/stations', label: 'Stations', icon: 'pin' as const }] : []),
    ...(canManageStaff ? [{ href: '/parcel-org/team', label: 'Team', icon: 'users' as const }] : []),
    // Everyone's own sign-in and PIN — riders holding a temporary invite
    // PIN need this more than anyone, so it is never capability-gated.
    { href: '/parcel-org/security', label: 'Security', icon: 'key' },
  ];

  return (
    <div className="porg">
      <DemoBanner />
      <header className="porgbar">
        <div className="porgbar-in">
          <Link href="/parcel-org" className="porgbrand" aria-label="Esoqo home">
            <Logo />
            <span className="porg-name">
              {me.org.name}
              <small>Courier company</small>
            </span>
          </Link>
          <ParcelOrgNav items={nav} />
          <form action="/parcel-org/signout" method="post" className="porg-signout">
            <button className="btn btn-o btn-sm" type="submit">
              <Icon name="close" size={15} />Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="porg-wrap">{children}</div>
    </div>
  );
}
