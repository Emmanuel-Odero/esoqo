/**
 * The same (path, capability) pairs Shell.tsx's NAV renders from,
 * flattened and kept in priority order — Shell.tsx is 'use client' and
 * carries icon/label data server code doesn't need, so this is a
 * second, minimal copy rather than importing that file into a server
 * component. Keep the two in sync by hand when a section's route or
 * gating capability changes.
 *
 * Used by requireStaff-adjacent pages (the dashboard root today) to
 * send a staff account straight to the first section it can actually
 * open, instead of hard-crashing on whichever section happens to be
 * the default landing page.
 */
export const NAV_ROUTES: { path: string; capability: string }[] = [
  { path: "/", capability: "report.read" },
  { path: "/registrations", capability: "registration.read" },
  { path: "/payments", capability: "payment.read" },
  { path: "/documents", capability: "document.read" },
  { path: "/groups", capability: "party.read" },
  { path: "/estores", capability: "store.read" },
  { path: "/estores/orders", capability: "order.read" },
  { path: "/estores/pricing", capability: "pricing.read" },
  { path: "/ticketing", capability: "ticketorg.read" },
  { path: "/vouchers", capability: "ticketorg.read" },
  { path: "/parcels", capability: "parcels.read" },
  { path: "/parcels/counter", capability: "parcels.assign" },
  { path: "/parcels/operations", capability: "parcels.assign" },
  { path: "/parcels/live", capability: "parcels.read" },
  { path: "/parcels/companies", capability: "parcels.read" },
  { path: "/parcels/cod", capability: "parcels.read" },
  { path: "/parcels/payouts", capability: "parcels.read" },
  { path: "/parcels/couriers", capability: "parcels.couriers.manage" },
  { path: "/parcels/teams", capability: "parcels.couriers.manage" },
  { path: "/parcels/labels", capability: "parcels.assign" },
  { path: "/parcels/pricing", capability: "parcel_pricing.write" },
  { path: "/jamii-overview", capability: "jamii-page.read" },
  { path: "/jamii-donations", capability: "jamii-donation.read" },
  { path: "/staff", capability: "staff.read" },
  { path: "/audit", capability: "audit.read" },
  { path: "/support-tickets", capability: "support-ticket.read" },
];

function allowed(caps: string[], need: string): boolean {
  return (
    caps.includes("*") ||
    caps.some((c) => c === need || c.startsWith(`${need.split(".")[0]}.`))
  );
}

/** The first route this ctx's capabilities can actually open, or null
 *  if none of them apply (a staff account with no read capability at
 *  all — should not happen in practice, but every caller must still
 *  handle it rather than assume a route always comes back). */
export function firstAccessibleRoute(capabilities: string[]): string | null {
  for (const route of NAV_ROUTES) {
    if (allowed(capabilities, route.capability)) return route.path;
  }
  return null;
}
