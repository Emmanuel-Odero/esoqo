import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { getDisplayPrefs } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { PrefsApplier } from './PrefsApplier';
import './me.css';

export const metadata: Metadata = { title: { default: 'Your record', template: '%s · Esoko' } };

const NAV = [
  ['/me', 'user', 'Your record'],
  ['/me/documents', 'document', 'Documents'],
  ['/me/payments', 'coins', 'Payments'],
  ['/me/consents', 'eye', 'Who can see it'],
  ['/me/group', 'users', 'Your group'],
  ['/me/settings', 'grid', 'How this looks'],
] as const;

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSubject();
  const prefs = await getDisplayPrefs(ctx);

  return (
    <div className="me">
      <PrefsApplier prefs={prefs} />
      <nav className="metabs" aria-label="Your record">
        {NAV.map(([href, icon, label]) => (
          <Link key={href} href={href}>
            <Icon name={icon} size={17} />{label}
          </Link>
        ))}
      </nav>
      <div className="wrap">{children}</div>
    </div>
  );
}
