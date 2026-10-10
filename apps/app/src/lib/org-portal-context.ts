/**
 * Org Portal Context
 *
 * Provides type-specific portal metadata and configuration.
 * This allows each org type to define its own:
 * - Navigation structure
 * - Default home page path
 * - Portal stylesheet/theme
 * - Sign-out action
 * - Metadata fetching
 */

import type { OrgPortalNavItem } from "@/components/OrgPortalNav";

/**
 * Portal handler for a specific org type.
 * Defines how that org type's portal should be structured and rendered.
 */
export interface OrgPortalHandler {
  /**
   * Org type ID (e.g., 'courier', 'hotel', 'ticket')
   */
  orgType: string;

  /**
   * Get the subtitle for this org type (e.g., "Courier company", "Hotel")
   */
  getSubtitle: () => string;

  /**
   * Get the base home link for this org type (e.g., "/org/courier/123")
   */
  getHomeLink: (orgId: string) => string;

  /**
   * Get the sign-out action path (e.g., "/orgs/signout")
   */
  getSignOutAction: () => string;

  /**
   * Get navigation items for this org type.
   * Called with capabilities from the current session to gate nav items.
   */
  getNavItems: (args: {
    orgId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
  }) => OrgPortalNavItem[];

  /**
   * CSS class prefix for styling — all handlers share "orgportal",
   * which is what apps/app/src/components/orgportal.css defines.
   */
  stylePrefix: string;

  /**
   * Fetch org metadata needed for this portal.
   * Optional: if not provided, metadata will be empty.
   */
  fetchMetadata?: (orgId: string) => Promise<Record<string, unknown>>;
}

/**
 * Registry of org type portal handlers.
 * Add a new handler here when adding support for a new org type.
 */
const portalHandlers: Map<string, OrgPortalHandler> = new Map();

/**
 * Register a portal handler for an org type.
 */
export function registerOrgPortalHandler(handler: OrgPortalHandler): void {
  portalHandlers.set(handler.orgType, handler);
}

/**
 * Get the portal handler for an org type.
 */
export function getOrgPortalHandler(
  orgType: string,
): OrgPortalHandler | undefined {
  return portalHandlers.get(orgType);
}

/**
 * Check if an org type has a registered portal handler.
 */
export function hasOrgPortalHandler(orgType: string): boolean {
  return portalHandlers.has(orgType);
}

/**
 * Get all registered org type portal handlers.
 */
export function getAllOrgPortalHandlers(): OrgPortalHandler[] {
  return Array.from(portalHandlers.values());
}

/**
 * Portal handler for ticket/transport organizations.
 * Maps the legacy /org/[orgId] routes to the new /org/ticket/[id] structure.
 */
export const ticketPortalHandler: OrgPortalHandler = {
  orgType: "ticket",
  getSubtitle: () => "Event/Transport organiser",
  getHomeLink: (orgId: string) => `/org/ticket/${orgId}`,
  getSignOutAction: () => "/orgs/signout",
  stylePrefix: "orgportal",
  getNavItems: (args: {
    orgId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
  }) => {
    const { orgId, capabilities, metadata } = args;

    const vertical = metadata?.vertical || "EVENT";

    const items: OrgPortalNavItem[] = [
      {
        href: `/org/ticket/${orgId}`,
        label: "Dashboard",
        icon: "grid",
        show: true,
      },
      {
        href: `/org/ticket/${orgId}/fleet`,
        label: "Fleet",
        icon: "truck",
        show: vertical === "TRANSPORT" && capabilities.includes("fleet.read"),
      },
      {
        href: `/org/ticket/${orgId}/fleet/pricing`,
        label: "Fares",
        icon: "tag",
        show: vertical === "TRANSPORT" && capabilities.includes("fleet.read"),
      },
      {
        href: `/org/ticket/${orgId}/luggage`,
        label: "Luggage",
        icon: "package",
        show: vertical === "TRANSPORT" && capabilities.includes("luggage.read"),
      },
      {
        href: `/org/ticket/${orgId}/listings`,
        label: "Listings",
        icon: "calendar",
        show: capabilities.includes("listing.write"),
      },
      {
        href: `/org/ticket/${orgId}/bookings`,
        label: "Bookings",
        icon: "document",
        show: capabilities.includes("booking.read"),
      },
      {
        href: `/org/ticket/${orgId}/scan`,
        label: "Scan tickets",
        icon: "qr",
        show: capabilities.includes("ticket.checkin"),
      },
      {
        href: `/org/ticket/${orgId}/staff`,
        label: "Staff",
        icon: "users",
        show: capabilities.includes("ticketorgstaff.write"),
      },
    ];

    return items;
  },
};

/**
 * Portal handler for hotel organizations.
 */
export const hotelPortalHandler: OrgPortalHandler = {
  orgType: "hotel",
  getSubtitle: () => "Hotel",
  getHomeLink: (orgId: string) => `/org/hotel/${orgId}`,
  getSignOutAction: () => "/orgs/signout",
  stylePrefix: "orgportal",
  getNavItems: (args: { orgId: string; capabilities: string[] }) => {
    const { orgId, capabilities } = args;

    const items: OrgPortalNavItem[] = [
      {
        href: `/org/hotel/${orgId}`,
        label: "Dashboard",
        icon: "grid",
        show: true,
      },
      {
        href: `/org/hotel/${orgId}/rooms`,
        label: "Rooms",
        icon: "building",
        show: capabilities.includes("hotel.rooms.read"),
      },
      {
        href: `/org/hotel/${orgId}/reservations`,
        label: "Reservations",
        icon: "calendar",
        show: capabilities.includes("hotel.reservations.read"),
      },
      {
        href: `/org/hotel/${orgId}/staff`,
        label: "Staff",
        icon: "users",
        show: capabilities.includes("hotel.staff.write"),
      },
      {
        href: `/org/hotel/${orgId}/settings`,
        label: "Settings",
        icon: "grid",
        show: true,
      },
    ];

    return items;
  },
};

/**
 * Portal handler for eatery organizations.
 */
export const eateryPortalHandler: OrgPortalHandler = {
  orgType: "eatery",
  getSubtitle: () => "Restaurant/Eatery",
  getHomeLink: (orgId: string) => `/org/eatery/${orgId}`,
  getSignOutAction: () => "/orgs/signout",
  stylePrefix: "orgportal",
  getNavItems: (args: { orgId: string; capabilities: string[] }) => {
    const { orgId, capabilities } = args;

    const items: OrgPortalNavItem[] = [
      {
        href: `/org/eatery/${orgId}`,
        label: "Dashboard",
        icon: "grid",
        show: true,
      },
      {
        href: `/org/eatery/${orgId}/menu`,
        label: "Menu",
        icon: "document",
        show: capabilities.includes("eatery.menu.write"),
      },
      {
        href: `/org/eatery/${orgId}/orders`,
        label: "Orders",
        icon: "inbox",
        show: capabilities.includes("eatery.orders.read"),
      },
      {
        href: `/org/eatery/${orgId}/staff`,
        label: "Staff",
        icon: "users",
        show: capabilities.includes("eatery.staff.write"),
      },
      {
        href: `/org/eatery/${orgId}/settings`,
        label: "Settings",
        icon: "grid",
        show: true,
      },
    ];

    return items;
  },
};

/**
 * Portal handler for chama organizations.
 */
export const chamaPortalHandler: OrgPortalHandler = {
  orgType: "chama",
  getSubtitle: () => "Chama/Savings Group",
  getHomeLink: (orgId: string) => `/org/chama/${orgId}`,
  getSignOutAction: () => "/orgs/signout",
  stylePrefix: "orgportal",
  getNavItems: (args: { orgId: string; capabilities: string[] }) => {
    const { orgId, capabilities } = args;

    const items: OrgPortalNavItem[] = [
      {
        href: `/org/chama/${orgId}`,
        label: "Dashboard",
        icon: "grid",
        show: true,
      },
      {
        href: `/org/chama/${orgId}/members`,
        label: "Members",
        icon: "users",
        show: true,
      },
      {
        href: `/org/chama/${orgId}/savings`,
        label: "Savings",
        icon: "coins",
        show: capabilities.includes("chama.savings.read"),
      },
      {
        href: `/org/chama/${orgId}/loans`,
        label: "Loans",
        icon: "coins",
        show: capabilities.includes("chama.loans.read"),
      },
      {
        href: `/org/chama/${orgId}/settings`,
        label: "Settings",
        icon: "grid",
        show: true,
      },
    ];

    return items;
  },
};

/**
 * Portal handler for tout organizations.
 */
export const toutPortalHandler: OrgPortalHandler = {
  orgType: "tout",
  getSubtitle: () => "Tout/Broker",
  getHomeLink: (orgId: string) => `/org/tout/${orgId}`,
  getSignOutAction: () => "/orgs/signout",
  stylePrefix: "orgportal",
  getNavItems: (args: { orgId: string; capabilities: string[] }) => {
    const { orgId, capabilities } = args;

    const items: OrgPortalNavItem[] = [
      {
        href: `/org/tout/${orgId}`,
        label: "Dashboard",
        icon: "grid",
        show: true,
      },
      {
        href: `/org/tout/${orgId}/routes`,
        label: "Routes",
        icon: "map",
        show: capabilities.includes("tout.routes.read"),
      },
      {
        href: `/org/tout/${orgId}/bookings`,
        label: "Bookings",
        icon: "calendar",
        show: capabilities.includes("tout.bookings.read"),
      },
      {
        href: `/org/tout/${orgId}/staff`,
        label: "Staff",
        icon: "users",
        show: capabilities.includes("tout.staff.write"),
      },
      {
        href: `/org/tout/${orgId}/settings`,
        label: "Settings",
        icon: "grid",
        show: true,
      },
    ];

    return items;
  },
};

/**
 * Initialize the portal handler registry with all built-in handlers.
 */
export function initializePortalHandlers(): void {
  registerOrgPortalHandler(ticketPortalHandler);
  registerOrgPortalHandler(hotelPortalHandler);
  registerOrgPortalHandler(eateryPortalHandler);
  registerOrgPortalHandler(chamaPortalHandler);
  registerOrgPortalHandler(toutPortalHandler);
}
