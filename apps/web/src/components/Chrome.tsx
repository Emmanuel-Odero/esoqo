'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@esoko/ui';

/** Nav is tools, not arguments — per the page-architecture work. The
 *  logo already links home, but that's an icon-only affordance; "Home"
 *  gets its own labelled entry so getting back to the landing page
 *  doesn't depend on recognising the logo as a link. */
export const NAV = [
  ['/', 'Home'],
  ['/discover', 'Shops'],
  ['/prices', 'Prices'],
  ['/counties', 'Counties'],
  ['/institutions', 'Institutions'],
  ['/verify', 'Verify'],
  ['/help', 'Help'],
] as const;

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`lock${inverse ? ' inv' : ''}`}>
      <svg viewBox="0 0 132 124" width="30" height="28" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round">
          <path d="M 118 62 A 40 40 0 1 0 110.8 84.9" />
          <path d="M 38 62 L 118 62" />
          <path d="M 38 62 L 8 45" />
        </g>
      </svg>
      <span className="w">soko</span>
      <span className="sr-only">Esoko home</span>
    </span>
  );
}

export function Header() {
  const path = usePathname();

  return (
    <header>
      <div className="wrap">
        <div className="hd">
          <Link href="/" aria-label="Esoko home"><Logo /></Link>
          <nav className="hdnav" id="nav" aria-label="Main">
            {NAV.map(([href, label]) => {
              // /counties also covers /counties/[slug] — a nested page is
              // still "on" that section, not off the map entirely.
              const active = path === href || path.startsWith(`${href}/`);
              return (
                <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="row">
            <a className="btn btn-o btn-sm" href={`${APP}/signin`}>Sign in</a>
            <a className="btn btn-p btn-sm" href={`${APP}/join`}>
              <Icon name="arrow-right" size={15} />Join free
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer id="help">
      <div className="wrap">
        <div className="fg">
          <div>
            <Logo inverse />
            <p style={{ maxWidth: '32ch', marginTop: 14 }}>
              Registrations, permits, licences and trading records for Kenya’s traders, groups,
              artisans and institutions.
            </p>
            {/* WCAG 2.2 · 3.2.6 Consistent Help — same place, every page. */}
            <p className="mono" style={{ fontSize: '.95rem', color: '#fff', marginTop: 12, letterSpacing: '.05em' }}>
              *483*77#
            </p>
          </div>
          <div>
            <h2>Tools</h2>
            <Link href="/prices">Market prices</Link>
            <Link href="/verify">Verify a certificate</Link>
            <Link href="/counties">County requirements</Link>
            <Link href="/institutions">Institutions</Link>
          </div>
          <div>
            <h2>Help</h2>
            <Link href="/help">Using *483*77#</Link>
            <Link href="/help#sms">SMS commands</Link>
            <Link href="/help#lost">Lost phone or PIN</Link>
            <Link href="/help#contact">Talk to a person</Link>
          </div>
          <div>
            <h2>Trust</h2>
            <Link href="/trust">Who runs Esoko</Link>
            <Link href="/trust#data">Your data</Link>
            <Link href="/trust#fraud">Report fraud</Link>
            <Link href="/trust#complaints">Complaints</Link>
          </div>
        </div>
        <div className="fb">
          <span>Esoko Limited · Nairobi, Kenya · Operated alongside the Child &amp; Elder Care Foundation</span>
          <span className="mono">Registered data controller · ODPC/REG/[number]</span>
        </div>
      </div>
    </footer>
  );
}

/** Sticky in-page nav with scroll-spy. */
export function SectionNav({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <div className="snav-wrap">
      <div className="snav">
        <div className="wrap">
          <div className="snav-in" id="snav">
            {items.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </div>
        </div>
      </div>
      <div className="prog" id="sprog" />
    </div>
  );
}
