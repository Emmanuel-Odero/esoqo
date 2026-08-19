'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { orgHref, orgInitials, WHITELABEL_NAV_SECTIONS, type OrgLinkMode } from '@/lib/org-links-shared';
import { useWhitelabelTheme } from '@/lib/whitelabel-theme';

/**
 * The custom-domain replacement for SiteHeader + OrgHeader/OrgSubnav —
 * ported from the provided template's accessibility toolbar + sticky
 * header, ".wl-site-head" in jamii.css. The org's own logo/name stand
 * in as the site's wordmark, and the section links that were a
 * secondary sub-nav on ourjamii.co.ke become the primary navigation.
 *
 * Never rendered on the primary domain — OrgSectionShell picks this or
 * OrgHeader/OrgSubnav based on `mode`, never both.
 */
export function OrgTopNav({
  orgName, logoUrl, mode, ctaHref, ctaLabel,
}: {
  orgName: string;
  logoUrl: string | null;
  verified: boolean;
  mode: OrgLinkMode;
  ctaHref: ReturnType<typeof orgHref> | null;
  ctaLabel: string;
}) {
  const pathname = usePathname();
  const { theme, toggleTheme, contrast, setContrast, motionOff, setMotionOff, scaleIdx, setScaleIdx } = useWhitelabelTheme();
  const [navOpen, setNavOpen] = useState(false);
  const isDark = theme === 'dark';

  useEffect(() => setNavOpen(false), [pathname]);

  const homeHref = orgHref(mode, '');
  const links = WHITELABEL_NAV_SECTIONS.map(([key, label]) => {
    const href = orgHref(mode, key);
    // Home ('') is only ever an exact match — every path starts with
    // '/', so the startsWith check other items use would make Home
    // look "current" everywhere.
    const on = pathname === href || (key !== '' && pathname.startsWith(`${href}/`));
    return { key, label, href, on };
  });

  return (
    <div className="wl-site-head">
      <div className="wl-a11y-bar" role="region" aria-label="Accessibility settings">
        <div className="wl-a11y-inner">
          <span className="wl-a11y-label">Accessibility</span>
          <div className="wl-a11y-controls">
            <button type="button" aria-label="Decrease text size" onClick={() => setScaleIdx(scaleIdx - 1)}>A−</button>
            <button type="button" aria-label="Reset text size" onClick={() => setScaleIdx(1)}>A</button>
            <button type="button" aria-label="Increase text size" onClick={() => setScaleIdx(scaleIdx + 1)}>A+</button>
            <button type="button" aria-pressed={contrast} aria-label="Toggle high contrast" onClick={() => setContrast(!contrast)}>
              High contrast
            </button>
            <button type="button" aria-pressed={motionOff} aria-label="Reduce motion" onClick={() => setMotionOff(!motionOff)}>
              Reduce motion
            </button>
            <button type="button" aria-pressed={isDark} aria-label="Toggle dark theme" onClick={toggleTheme}>
              <span className="wl-theme-toggle-icon">{isDark ? '☀' : '☾'}</span> {isDark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>
      </div>

      <header className="wl-header">
        <div className="wl-nav-inner">
          <Link href={homeHref} className="wl-brand">
            <span className="wl-brand-mark" aria-hidden={logoUrl ? undefined : true}>
              {logoUrl ? <img src={logoUrl} alt="" /> : orgInitials(orgName)}
            </span>
            <span className="wl-brand-word">{orgName}</span>
          </Link>

          <button
            type="button" className="wl-navtoggle" aria-expanded={navOpen} aria-controls="primaryNav"
            aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? '✕' : '☰'}
          </button>

          <nav id="primaryNav" className={`wl-navlinks${navOpen ? ' open' : ''}`} aria-label="Site sections">
            {links.map((l) => (
              <Link key={l.key} href={l.href} aria-current={l.on ? 'page' : undefined}>{l.label}</Link>
            ))}
          </nav>

          <div className="wl-nav-cta">
            <button type="button" className="wl-cta-ghost wl-theme-toggle" aria-pressed={isDark} aria-label="Toggle dark theme" onClick={toggleTheme}>
              <span className="wl-theme-toggle-icon">{isDark ? '☀' : '☾'}</span>
              <span className="wl-theme-toggle-label">{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
            {ctaHref && <Link href={ctaHref} className="wl-cta">{ctaLabel}</Link>}
          </div>
        </div>
      </header>
    </div>
  );
}
