"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Icon, type IconName } from "@esoqo/ui";
import { useAnnounce } from "@esoqo/a11y";

export interface NavItem {
  href: Route;
  icon: IconName;
  label: string;
}

/**
 * The dashboard navigation, one source of truth in two presentations:
 *
 *   Desktop (≥820px) → the primary tabs sit inline in the header bar;
 *                      the More button sits at the bar's right edge.
 *   Mobile           → the same primary tabs move to a fixed bottom tab
 *                      bar (thumbs, not eyes), with More in the bar too.
 *
 * "More" opens a bottom sheet holding the trust + display screens and
 * sign out, on every screen size.
 */
export function ShellNav({
  items,
  more,
}: {
  items: NavItem[];
  more: NavItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const announce = useAnnounce();
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // "/me" is the dashboard home AND the prefix of every other tab's route
  // (/me/group, /me/payments, ...), so the usual "startsWith" nested-match
  // would light up "Record" on every single tab at once. It gets an exact
  // match only; every other item keeps matching its own subtree too.
  const isActive = (href: string) =>
    pathname === href || (href !== "/me" && pathname.startsWith(`${href}/`));

  // Keep focus inside the sheet while it's open; return it on close.
  useEffect(() => {
    if (!open || !justOpened) return;
    const t = window.setTimeout(
      () => sheetRef.current?.querySelector<HTMLElement>("a,button")?.focus(),
      0,
    );
    return () => window.clearTimeout(t);
  }, [open, justOpened]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setJustOpened(next);
    announce(next ? "More menu opened" : "More menu closed", "polite");
    if (!next) moreBtnRef.current?.focus();
  }

  return (
    <>
      {/* Desktop primary tabs, inline in the header bar. */}
      <nav className="headnav" aria-label="Primary">
        {items.map(({ href, icon, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            aria-label={label}
          >
            <Icon name={icon} size={16} aria-hidden="true" />
            {label}
          </Link>
        ))}
        {/* Settings is now always visible in desktop nav (not hidden in More) */}
        {more.find((m) => m.href === "/me/settings") && (
          <Link
            key="/me/settings"
            href="/me/settings"
            aria-current={isActive("/me/settings") ? "page" : undefined}
            aria-label="Settings"
          >
            <Icon name="grid" size={16} aria-hidden="true" />
            Settings
          </Link>
        )}
      </nav>

      {/* Mobile bottom tab bar — thumbs, not eyes. Settings stays in main bar. */}
      <nav className="tabbar" aria-label="Primary">
        {items.map(({ href, icon, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            aria-label={label}
          >
            <Icon name={icon} size={19} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        {/* Settings tab on mobile - essential enough to be primary */}
        {more.find((m) => m.href === "/me/settings") && (
          <Link
            key="/me/settings"
            href="/me/settings"
            aria-current={isActive("/me/settings") ? "page" : undefined}
            aria-label="Settings"
          >
            <Icon name="grid" size={19} aria-hidden="true" />
            <span>Settings</span>
          </Link>
        )}
      </nav>

      {/* Only show "More" button if there are items beyond primary nav */}
      {more.length > (more.find((m) => m.href === "/me/settings") ? 1 : 0) && (
        <>
          <button
            type="button"
            ref={moreBtnRef}
            className="morebtn"
            aria-expanded={open}
            aria-controls="more-sheet"
            aria-label={open ? "Close more menu" : "Open more menu"}
            onClick={toggle}
          >
            <Icon name="grid" size={15} aria-hidden="true" />
            <span>{open ? "Close" : "More"}</span>
          </button>

          {open && (
            <div
              className="sheet-scrim"
              // Close only for a click ON the scrim itself. Without this
              // check, any click inside the sheet bubbles up here too —
              // harmless for the Link rows (Next's router navigates
              // regardless of whether the DOM node survives), but fatal
              // for the Sign out button: this handler's setOpen(false)
              // unmounts the form synchronously, in the same event, before
              // the browser gets to run the submit button's native default
              // action — so the sheet closes and the POST never fires.
              onClick={(e) => {
                if (e.target === e.currentTarget) toggle();
              }}
              role="presentation"
            >
              <div
                className="sheet"
                id="more-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="More options"
                ref={sheetRef}
              >
                <div className="sheet-handle" aria-hidden="true" />
                <p className="kicker" style={{ margin: "4px 0 10px" }}>
                  More
                </p>
                {more
                  .filter((m) => m.href !== "/me/settings")
                  .map(({ href, icon, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="sheet-row"
                      onClick={() => setOpen(false)}
                      aria-label={label}
                    >
                      <span className="icbox" aria-hidden="true">
                        <Icon name={icon} size={16} />
                      </span>
                      <span>{label}</span>
                      <Icon
                        name="chevron-right"
                        size={16}
                        className="chev"
                        aria-hidden="true"
                      />
                    </Link>
                  ))}
                <div className="sheet-sep" role="separator" />
                {/* A form, not a link: signing out changes state, so it must
                    not be reachable by GET (see the route's own comment). */}
                <form action="/signout" method="post">
                  <button
                    type="submit"
                    className="sheet-row danger"
                    aria-label="Sign out of Esoqo"
                  >
                    <span className="icbox" aria-hidden="true">
                      <Icon name="close" size={16} />
                    </span>
                    <span>Sign out</span>
                  </button>
                </form>
                <p className="hint" style={{ margin: "14px 6px 0" }}>
                  Signing out hides your record on this device. Your PIN never
                  leaves your phone.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
