import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@esoqo/ui';
import { getDisplayPrefs } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { listWorkspaces } from '@/lib/workspaces';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { PrefsApplier } from './PrefsApplier';
import { ShellNav, type NavItem } from './ShellNav';
import './me.css';

export const metadata: Metadata = { title: { default: 'Your profile', template: '%s · Esoqo' } };

// Wallet takes the primary slot Tickets used to hold — money is the more
// frequent reason somebody opens this bar. Tickets moves into More rather
// than off the map; Vouchers & loyalty stop being their own door because
// they're now a section inside Wallet, not a separate destination.
const PRIMARY: NavItem[] = [
  { href: '/me', icon: 'user', label: 'Profile' },
  { href: '/me/group', icon: 'users', label: 'Group' },
  { href: '/me/payments', icon: 'coins', label: 'Payments' },
  { href: '/me/wallet', icon: 'bank', label: 'Wallet' },
];

const MORE: NavItem[] = [
  { href: '/me/tickets', icon: 'qr', label: 'Tickets' },
  { href: '/me/organiser', icon: 'calendar', label: 'Sell tickets (events & transport)' },
  { href: '/me/consents', icon: 'eye', label: 'Who can see your info' },
  { href: '/me/settings', icon: 'grid', label: 'Settings' },
];

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSubject();
  const [prefs, workspaces] = await Promise.all([getDisplayPrefs(ctx), listWorkspaces()]);

  return (
    <div className="me">
      <PrefsApplier prefs={prefs} />
      <header className="appbar">
        <div className="appbar-in">
          {/* Wordmark, then the workspace identity. The bar used to spell
              "Esoqo / Your record" as static text; that second line is
              now the switcher's own subtitle, so the same information
              carries the way out to a company the person works for. */}
          <Link href="/me" className="appbrand" aria-label="Esoqo home">
            <Logo />
          </Link>
          <span className="appbar-div" aria-hidden="true" />
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentKey="personal"
            fallbackName="Esoqo"
            fallbackSubtitle="Your own profile"
          />
          <ShellNav items={PRIMARY} more={MORE} />
        </div>
      </header>
      <div className="wrap">{children}</div>
    </div>
  );
}