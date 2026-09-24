import type { Metadata } from 'next';
import OrgPortalShell from '@/components/OrgPortalShell';

export const metadata: Metadata = {
  title: { default: 'Organization portal', template: '%s · Esoqo' },
};

/**
 * Unified org portal layout for all org types.
 *
 * This layout replaces both:
 * - /parcel-org/layout.tsx (courier portal)
 * - /org/[orgId]/layout.tsx (ticketing portal)
 *
 * It delegates the portal shell (session resolution, nav header, workspace
 * switcher, sign-out) to the shared OrgPortalShell component, which is driven
 * by the OrgPortalHandler registry. New org types can be added by registering
 * a handler in org-portal-context.ts without modifying this layout.
 *
 * Route structure: /org/[type]/[id]/...
 * Examples:
 * - /org/ticket/789/listings
 * - /org/eatery/456/orders
 *
 * Static per-type branches (/org/courier, /org/hotel) provide their own
 * thin layouts that render the same OrgPortalShell.
 */
export default async function OrgPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ type: string; id: string }>;
}) {
  const { type: orgType, id: orgId } = await params;

  return (
    <OrgPortalShell orgType={orgType} orgId={orgId}>
      {children}
    </OrgPortalShell>
  );
}