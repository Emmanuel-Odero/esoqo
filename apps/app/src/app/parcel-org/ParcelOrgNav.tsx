"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useRef, useEffect, useState } from "react";
import { Icon, type IconName } from "@esoqo/ui";

export interface ParcelOrgNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
}

/**
 * The courier portal's main nav.
 *
 * Client-side only for the active state: the server layout knows the
 * capabilities and builds the item list, but only the browser knows the
 * current path, and the old server-only links never set aria-current —
 * so no tab ever looked selected. On phones this becomes a single
 * horizontally-scrollable strip (see parcel-org.css) instead of the
 * wrapped multi-row block it used to collapse into.
 */
export function ParcelOrgNav({ items }: { items: ParcelOrgNavItem[] }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const isActive = (href: string) =>
    href === "/parcel-org"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const checkScroll = () => {
    if (!navRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = navRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
  };

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    // Initial check
    checkScroll();

    // Listen for scroll events
    nav.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);

    return () => {
      nav.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, []);

  return (
    <div className="porgnav-container">
      <nav ref={navRef} className="porgnav" aria-label="Main">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
            {item.badge ? (
              <span className="porgnav-badge">{item.badge}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      {canScrollLeft && (
        <div className="porgnav-scroll porgnav-scroll-left" aria-hidden="true">
          ‹
        </div>
      )}
      {canScrollRight && (
        <div className="porgnav-scroll porgnav-scroll-right" aria-hidden="true">
          ›
        </div>
      )}
    </div>
  );
}
