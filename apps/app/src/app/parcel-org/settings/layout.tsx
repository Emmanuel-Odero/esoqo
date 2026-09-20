import type { Metadata } from 'next';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { SettingsNav } from './SettingsNav';
import { sectionsFor } from './sections';

export const metadata: Metadata = { title: { default: 'Settings', template: '%s · Esoqo' } };

/**
 * Settings — one door for everything a company configures rather than
 * operates.
 *
 * Rates, label stock, stations, team and sign-in used to be five
 * top-level nav entries, which meant more than half the portal's main
 * nav was things you touch once a month, sitting beside the things you
 * touch once a minute. They are tabs now, and the nav is operational.
 *
 * Tolerant of a dead session for the same reason the portal layout is:
 * a redirect here would fight each page's own redirect. An
 * unauthenticated render just draws the children with no sub-nav, and
 * the child page's own redirect fires on the next paint.
 */
export default async function ParcelOrgSettingsLayout(
  { children }: { children: React.ReactNode },
) {
  const me = await getParcelOrgMe().catch((e) => {
    if (e instanceof ParcelOrgUnauthorised) return null;
    throw e;
  });

  if (!me) return <>{children}</>;

  return (
    <div className="porgset">
      <div className="head">
        <div>
          <p className="kicker">{me.org.name}</p>
          <h1>Settings</h1>
          <p>How this company is set up — its prices, its places, and its people.</p>
        </div>
      </div>
      <SettingsNav items={sectionsFor(me.capabilities)} />
      <div className="porgset-body">{children}</div>
    </div>
  );
}
