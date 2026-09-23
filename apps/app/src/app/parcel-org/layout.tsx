import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, Logo } from '@esoqo/ui';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { listWorkspaces } from '@/lib/workspaces';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ParcelOrgNav, type ParcelOrgNavItem } from './ParcelOrgNav';
import { DemoBanner } from './DemoBanner';
import { DropoffPoll } from './DropoffPoll';
import './parcel-org.css';
// The shared component layer (panels, fields, stats, list rows) sits
// after the shell so page-level classes can still override it.
import './porg-ui.css';

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
  const [me, workspaces] = await Promise.all([
    getParcelOrgMe().catch((e) => {
      if (e instanceof ParcelOrgUnauthorised) return null;
      throw e;
    }),
    // Read with the PERSON's bearer, not the company's. A manager who
    // signed in as themselves gets the full switcher and can step back
    // to their own record — or across to a second company — without
    // dropping this shift session. A rider who came in through the
    // company's own door has no subject cookie, so this is empty and
    // the switcher degrades to a plain company nameplate.
    listWorkspaces(),
  ]);

  if (!me) return <>{children}</>;

  // Staff and station capabilities are no longer read here: those nav
  // entries became Settings tabs, and Settings decides its own tab list
  // from the same capabilities (see settings/sections.ts).
  const canManagePricing = me.capabilities.includes('parcelorg.write');
  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  const canSeeMoney = me.capabilities.includes('parcelorg.earnings');
  // Counter is the commercial desk — booking and the label stock a
  // booking spends. Receiving moved to the Scanner, so carry alone no
  // longer opens it.
  const canSell = canDispatch || canManagePricing;
  // The counter page carries both jobs now — booking (dispatch) and the
  // front-desk worklist (carry) — so anyone with either capability gets
  // the one nav entry.
  const canDesk = canDispatch || me.capabilities.includes('parcelorg.carry');
  // The scanner serves every role that touches a physical box — a rider
  // taking custody, an intake clerk receiving a walk-in, an arrival
  // clerk handing one over. Broader than Counter's gate on purpose:
  // Counter is about creating bookings, this is about boxes.
  const canScan = canDesk
    || me.capabilities.includes('parcelorg.intake')
    || me.capabilities.includes('parcelorg.arrival');

  const nav: ParcelOrgNavItem[] = [
    // One entry per job, each owned by exactly one page:
    // - Parcels  = review the register (review only — no booking, no
    //              scanning, no cash)
    // - Scan     = the ONLY scanner; a box in someone's hands
    // - Counter  = the commercial desk: book a parcel
    // - Money    = reconcile rider float
    // - Dispatch = runs / fleet board
    // - Settings = everything configured, not operated (tabs inside)
    { href: '/parcel-org', label: 'Parcels', icon: 'box' },
    // Scan sits second, right after the register, because it is the
    // entry point for every job that starts with a box in someone's
    // hands — which is most of them. It is the one page that needs no
    // decision before it is useful: open it and scan.
    // The badge counts senders expected at the desk. It sat on Counter
    // while the worklist did; it follows the worklist here.
    ...(canScan ? [{ href: '/parcel-org/scan', label: 'Scan', icon: 'qr' as const, badge: me.stats.awaitingDropoff || undefined }] : []),
    ...(canDispatch ? [{ href: '/parcel-org/dispatch', label: 'Dispatch', icon: 'send' as const }] : []),
    ...(canSell ? [{ href: '/parcel-org/counter', label: 'Counter', icon: 'plus' as const }] : []),
    // Counting cash in is its own job with its own page now — the
    // rider-float panel used to sit at the bottom of the register.
    ...(canSeeMoney ? [{ href: '/parcel-org/money', label: 'Money', icon: 'coins' as const }] : []),
    // Everything a company CONFIGURES rather than operates — rates,
    // label stock, stations, team, and everyone's own sign-in — is one
    // entry with tabs inside. These were five separate top-level
    // entries, so more than half this nav was things you touch once a
    // month sitting beside things you touch once a minute. Never gated:
    // the sign-in tab inside it is open to everyone, riders most of all.
    { href: '/parcel-org/settings', label: 'Settings', icon: 'grid' },
  ];

  return (
    <div className="porg">
      <DemoBanner />
      <header className="porgbar">
        <div className="porgbar-in">
          <Link href="/parcel-org" className="porgbrand" aria-label="Esoqo home">
            <Logo />
          </Link>
          <span className="appbar-div" aria-hidden="true" />
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentKey={`courier:${me.org.id}`}
            fallbackName={me.org.name}
            fallbackSubtitle="Courier company"
          />
          <ParcelOrgNav items={nav} />
          <form action="/parcel-org/signout" method="post" className="porg-signout">
            <button className="btn btn-o btn-sm" type="submit">
              <Icon name="close" size={15} />Sign out
            </button>
          </form>
        </div>
      </header>
      {/* Single auto-refresh for the whole portal: previously mounted
          separately on the dashboard and on dispatch, so two timers
          refreshed the same session. One mount here covers every page,
          and still stands down while a form is active (see DropoffPoll). */}
      <DropoffPoll />
      <div className="porg-wrap">{children}</div>
    </div>
  );
}
