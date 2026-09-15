import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@esoqo/ui';
import { getDisplayPrefs } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { PrefsApplier } from './PrefsApplier';
import { ShellNav, type NavItem } from './ShellNav';
import './me.css';

export const metadata: Metadata = { title: { default: 'Your record', template: '%s · Esoqo' } };

const PRIMARY: NavItem[] = [
  { href: '/me', icon: 'user', label: 'Record' },
  { href: '/me/group', icon: 'users', label: 'Group' },
  { href: '/me/payments', icon: 'coins', label: 'Payments' },
  { href: '/me/tickets', icon: 'qr', label: 'Tickets' },
  { href: '/me/documents', icon: 'document', label: 'Papers' },
];

const MORE: NavItem[] = [
  { href: '/me/organiser', icon: 'calendar', label: 'Sell tickets (events & transport)' },
  { href: '/me/consents', icon: 'eye', label: 'Who can see your info' },
  { href: '/me/settings', icon: 'grid', label: 'How this looks' },
];

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSubject();
  const prefs = await getDisplayPrefs(ctx);

  return (
    <div className="me">
      <PrefsApplier prefs={prefs} />
      <header className="appbar">
        <div className="appbar-in">
          <Link href="/me" className="appbrand" aria-label="Esoqo home">
            <Logo />
            <span className="appbar-name">
              Esoqo
              <small>Your record</small>
            </span>
          </Link>
          <ShellNav items={PRIMARY} more={MORE} />
        </div>
      </header>
      <div className="wrap">{children}</div>
    </div>
  );
}