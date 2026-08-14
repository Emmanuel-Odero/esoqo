import { can, type Ctx, type Capability } from '@esoko/db';

/**
 * Nav- and page-gating for the /org/[orgId] console. Mirrors what
 * assertOwnsOrg checks server-side in the DAL — this is UX only, the
 * DAL still refuses independently on every call. See ADR-0003.
 */
export function canOrg(ctx: Ctx, org: { enterprise: { partyId: string } }, capability: Capability): boolean {
  return can(ctx, capability, { partyId: org.enterprise.partyId });
}
