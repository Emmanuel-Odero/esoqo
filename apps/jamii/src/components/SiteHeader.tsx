'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Discover' },
  { href: '/start', label: 'Start a page' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Nav links collapse away below 880px (see jamii.css's .navlinks media
 * query) rather than into a hamburger panel — the Sign in / Start your
 * page CTAs, the pages a mobile visitor actually needs, stay visible
 * either way. A fuller mobile menu is easy to add later; not worth the
 * extra client state for this pass.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();

  return (
    <header className="topnav">
      <div className="wrap bar">
        <Link href="/" className="brand">
          <img src="/cecf-logo.png" alt="CECF logo" />
          <span>Our Jamii</span>
        </Link>
        <nav className="navlinks">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="navcta">
          <Link href={signedIn ? '/dashboard' : '/signin'} className="btn btn-ghost btn-sm">
            {signedIn ? 'Dashboard' : 'Sign in'}
          </Link>
          <Link href="/start" className="btn btn-stamp btn-sm">Start your page</Link>
        </div>
      </div>
    </header>
  );
}
