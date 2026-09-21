"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@esoqo/ui";

/** Nav is tools, not arguments — per the page-architecture work. The
 *  logo already links home, but that's an icon-only affordance; "Home"
 *  gets its own labelled entry so getting back to the landing page
 *  doesn't depend on recognising the logo as a link. */
export const NAV = [
  ["/", "Home"],
  ["/discover", "Shops"],
  ["/tickets", "Tickets"],
  ["/parcels", "Parcels"],
  ["/prices", "Prices"],
  ["/counties", "Counties"],
  ["/institutions", "Institutions"],
  ["/verify", "Verify"],
  ["/help", "Help"],
] as const;

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`lock${inverse ? " inv" : ""}`}>
      <img
        src={inverse ? "/esoko-logo-dark.png" : "/esoko-logo-light.png"}
        alt="Esoqo home"
        style={{ height: "60px", width: "auto", display: "block" }}
      />
      <span className="sr-only">Esoqo home</span>
    </span>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [path]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* The drawer below is deliberately NOT nested inside this
          <header>. header has backdrop-filter (for the sticky blur),
          and backdrop-filter — like filter/transform/perspective —
          establishes a new containing block for any position:fixed
          descendant (CSS Containing Block spec, ¶ backdrop-filter). A
          fixed-position drawer nested inside it resolves its inset
          against the header's own ~64px box instead of the viewport,
          collapsing to zero height — which is exactly why the mobile
          menu used to render but never visibly open. Keeping it a
          sibling here, still inside <body>, gives it the viewport as
          its containing block like any ordinary fixed element. */}
      <header>
        <div className="wrap">
          <div className="hd">
            <Link href="/" aria-label="Esoqo home">
              <Logo />
            </Link>
            <nav className="hdnav" id="nav" aria-label="Main">
              {NAV.map(([href, label]) => {
                // /counties also covers /counties/[slug] — a nested page is
                // still "on" that section, not off the map entirely.
                const active = path === href || path.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="row">
              {/* Quick receiving/confirmation, no account needed: an
                  owner checking a delivery or a tout confirming a
                  parcel is handed off shouldn't have to sign in first
                  to find out what a code is — see /scan. */}
              <Link className="btn btn-o btn-sm" href="/scan">
                <Icon name="qr" size={16} />Scan
              </Link>
              <a className="btn btn-p btn-sm" href={`${APP}/signin`}>
                Sign in
              </a>
            </div>
            <button
              className="hd-menu-btn"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? "close" : "menu"} size={22} />
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div className="hd-drawer-wrap">
          <button
            className="hd-scrim"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <nav className="hd-drawer" id="mobile-nav" aria-label="Mobile">
            {NAV.map(([href, label]) => {
              const active = path === href || path.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              );
            })}
            <div className="hd-drawer-cta">
              <Link className="btn btn-o" href="/scan">
                <Icon name="qr" size={16} />Scan a code
              </Link>
              <a className="btn btn-p" href={`${APP}/signin`}>
                Sign in
              </a>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

export function Footer() {
  return (
    <footer id="help">
      <div className="wrap">
        <div className="fg">
          <div>
            <Logo inverse />
            <p style={{ maxWidth: "32ch", marginTop: 14 }}>
              Registrations, permits, licences and trading records for Kenya’s
              traders, groups, artisans and institutions.
            </p>
            {/* WCAG 2.2 · 3.2.6 Consistent Help — same place, every page. */}
            <p
              className="mono"
              style={{
                fontSize: ".95rem",
                color: "#fff",
                marginTop: 12,
                letterSpacing: ".05em",
              }}
            >
              *483*77#
            </p>
          </div>
          <div>
            <h2>Tools</h2>
            <Link href="/prices">Market prices</Link>
            <Link href="/parcels/send">Send a parcel</Link>
            <Link href="/parcels/track">Track a parcel</Link>
            <Link href="/parcels/points">Drop-off &amp; pickup points</Link>
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
            <Link href="/trust">Who runs Esoqo</Link>
            <Link href="/trust#data">Your data</Link>
            <Link href="/trust#fraud">Report fraud</Link>
            <Link href="/trust#complaints">Complaints</Link>
          </div>
        </div>
        <div className="fb">
          <span>
            Esoqo Limited · Nairobi, Kenya · Operated alongside the Child &amp;
            Elder Care Foundation
          </span>
          <span className="mono">
            Registered data controller · ODPC/REG/[number]
          </span>
        </div>
      </div>
    </footer>
  );
}

/** Sticky in-page nav with scroll-spy. */
export function SectionNav({
  items,
}: {
  items: readonly (readonly [string, string])[];
}) {
  return (
    <div className="snav-wrap">
      <div className="snav">
        <div className="wrap">
          <div className="snav-in" id="snav">
            {items.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="prog" id="sprog" />
    </div>
  );
}
