"use client";

import Link from "next/link";
import { Icon, type IconName } from "@esoqo/ui";
import type { Route } from "next";

export interface OrgPortalNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  show?: boolean;
}

export interface OrgPortalNavProps {
  items: OrgPortalNavItem[];
  desktop?: boolean;
  mobile?: boolean;
  className?: string;
  stylePrefix?: string;
}

export function OrgPortalNav({
  items,
  desktop = false,
  mobile = false,
  className = "",
  stylePrefix = "orgportal",
}: OrgPortalNavProps) {
  const visibleItems = items.filter((item) => item.show !== false);

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
