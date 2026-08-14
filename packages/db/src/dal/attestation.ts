import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * The first focused attestation-issuing DAL function — there wasn't a
 * generic one before this (see dal/registration.ts for the one other
 * place Attestation rows get created, which is self-verification during
 * the join funnel, not staff-issued). Kept narrow on purpose rather than
 * a speculative "issue any claim" API.
 */

/**
 * Staff stamps a Jamii page "VERIFIED" after reviewing its registration
 * certificate and treasurer-ID Documents (apps/admin's existing
 * Documents review screen). Issued against the platform's own seeded
 * CECF Issuer row.
 */
export async function issueOrgPageVerification(ctx: Ctx, organisationPartyId: string) {
  requireCapability(ctx, 'attestation.issue');
  if (!ctx.actorId) throw new Error('Issuing a verification requires a named staff account');

  const issuer = await prisma.issuer.findUnique({ where: { name: 'Child & Elder Care Foundation' } });
  if (!issuer) throw new Error('CECF is not seeded as an issuer — run the db seed first');

  const existing = await prisma.attestation.findFirst({
    where: { subjectId: organisationPartyId, claimType: 'ORG_PAGE_VERIFIED', revokedAt: null },
  });
  if (existing) return existing;

  const attestation = await prisma.attestation.create({
    data: {
      subjectId: organisationPartyId,
      claimType: 'ORG_PAGE_VERIFIED',
      claimValue: { verifiedBy: ctx.actorId },
      issuerOrgId: issuer.id,
      issuerUserId: ctx.actorId,
      method: 'DOCUMENT',
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_page.verified', targetType: 'attestation', targetId: attestation.id,
    payload: { organisationPartyId },
  });
  return attestation;
}

export async function revokeOrgPageVerification(ctx: Ctx, organisationPartyId: string, reason: string) {
  requireCapability(ctx, 'attestation.revoke');
  const attestation = await prisma.attestation.findFirst({
    where: { subjectId: organisationPartyId, claimType: 'ORG_PAGE_VERIFIED', revokedAt: null },
  });
  if (!attestation) return null;

  const revoked = await prisma.attestation.update({
    where: { id: attestation.id },
    data: { revokedAt: new Date(), revocationReason: reason },
  });
  await recordAudit(ctx, {
    action: 'jamii_page.verification_revoked', targetType: 'attestation', targetId: attestation.id,
    payload: { organisationPartyId, reason },
  });
  return revoked;
}
