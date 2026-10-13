"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@esoqo/ui";

export interface OrgPortalNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Capability/permission gate — false hides the item entirely. */
  show?: boolean;
}

export interface OrgPortalNavProps {
  items: OrgPortalNavItem[];
  desktop?: boolean;
  mobile?: boolean;
  className?: string;
  stylePrefix?: string;
}

/**
 * The org portal's section nav, rendered twice — once inline in the
 * header (desktop) and once as a scrollable strip (mobile).
 *
 * Client-side for the same reason /parcel-org's nav is: the server shell
 * knows the capabilities and builds the item list, but only the browser
 * knows the current path. Without this, the active rule in
 * orgportal.css ([aria-current="page"]) never fired, so no tab ever
 * looked selected. The shortest href is the portal root and matches
 * exactly — every other tab keeps matching its own subtree.
 */
export function OrgPortalNav({
  items,
  desktop,
  mobile,
  className = "",
  stylePrefix = "orgportal",
}: OrgPortalNavProps) {
  const pathname = usePathname();
  const visibleItems = items.filter((item) => item.show !== false);
  const base = visibleItems.reduce(
    (shortest, item) => (item.href.length < shortest.href.length ? item : shortest),
    visibleItems[0] ?? { href: "" },
  ).href;

  const isActive = (href: string) =>
    pathname === href || (href !== base && pathname.startsWith(`${href}/`));

  if (desktop) {
    return (
      <nav
        className={`${stylePrefix}-nav ${className}`}
        aria-label="Portal navigation"
      >
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className={`${stylePrefix}-nav-item`}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
            {item.badge && item.badge > 0 && (
              <span className={`${stylePrefix}-nav-badge`}>{item.badge}</span>
            )}
          </Link>
        ))}
      </nav>
    );
  }

  if (mobile) {
    return (
      <nav
        className={`${stylePrefix}-nav-mobile ${className}`}
        aria-label="Portal navigation mobile"
      >
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className={`${stylePrefix}-nav-item-mobile`}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <Icon name={item.icon} size={20} />
            {item.label}
            {item.badge && item.badge > 0 && (
              <span className={`${stylePrefix}-nav-badge-mobile`}>
                {item.badge}
              </span>
            )}
          </Link>
        ))}
      </nav>
    );
  }

  return null;
}
