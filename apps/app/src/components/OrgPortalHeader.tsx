"use client";

import Link from "next/link";
import { Icon, Logo } from "@esoqo/ui";
import type { Route } from "next";
import type { Workspace } from "@/lib/workspaces";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import type { OrgPortalNavItem } from "./OrgPortalNav";
import { OrgPortalNav } from "./OrgPortalNav";

export interface OrgPortalHeaderProps {
  /**
   * The org type (courier, hotel, ticket, etc.)
   */
  orgType: string;

  /**
   * The org ID
   */
  orgId: string;

  /**
   * The org name for display
   */
  orgName: string;

  /**
   * The org subtitle (e.g., "Courier company", "Hotel")
   */
  orgSubtitle?: string;

  /**
   * Navigation items to display
   */
  navItems: OrgPortalNavItem[];

  /**
   * Available workspaces for switching
   */
  workspaces: Workspace[];

  /**
   * The current workspace key (e.g., "courier:123")
   */
  currentKey: string;

  /**
   * Sign-out action path (e.g., "/orgs/signout")
   */
  signOutAction: string;

  /**
   * Home link path (e.g., "/org/courier/123")
   */
  homeLink: string;

  /**
   * Additional CSS class
   */
  className?: string;

  /**
   * Whether to show mobile nav (default true)
   */
  showMobileNav?: boolean;

  /**
   * CSS module or stylesheet class prefix
   */
  stylePrefix?: string;
}

/**
 * Unified header component for all org portal types.
 * Replaces ParcelOrgNav/header and ticketing org header with a generic component
 * that works across all org types (courier, hotel, eatery, etc.).
 */
export function OrgPortalHeader({
  orgType,
  orgName,
  orgSubtitle,
  navItems,
  workspaces,
  currentKey,
  signOutAction,
  homeLink,
  className = "",
  showMobileNav = true,
  stylePrefix = "orgportal",
}: OrgPortalHeaderProps) {
  return (
    <header className={`${stylePrefix}-header ${className}`}>
      <div className={`${stylePrefix}-header-in`}>
        <Link
          href={homeLink as Route}
          className={`${stylePrefix}-brand`}
          aria-label="Org portal home"
        >
          <Logo />
        </Link>

        <span className="appbar-div" aria-hidden="true" />

        <WorkspaceSwitcher
          workspaces={workspaces}
          currentKey={currentKey}
          fallbackName={orgName}
          fallbackSubtitle={orgSubtitle || `${orgType} organization`}
        />

        {/* Desktop navigation */}
        <OrgPortalNav
          items={navItems}
          className={`${stylePrefix}-nav`}
          desktop
          stylePrefix={stylePrefix}
        />

        {/* Sign out button */}
        <form
          action={signOutAction}
          method="post"
          className={`${stylePrefix}-signout`}
        >
          <button className="btn btn-o btn-sm" type="submit">
            <Icon name="close" size={15} />
            Sign out
          </button>
        </form>

        {/* Mobile navigation */}
        {showMobileNav && (
          <OrgPortalNav
            items={navItems}
            className={`${stylePrefix}-nav-mobile`}
            mobile
            stylePrefix={stylePrefix}
          />
        )}
      </div>
    </header>
  );
}
