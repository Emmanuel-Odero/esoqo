import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { ALLOWED_TYPES } from './documents';
import { MAX_BYTES } from '../storage';
import { assertBusinessOfficer } from './payment-id';

/**
 * A business, chama or other organisation applying to claim its own
 * esoqo ID handle — typically its trading name — instead of the random
 * mnemonic every org otherwise gets (see previewBusinessHandleCandidates
 * in dal/payment-id.ts). Reuses the platform's existing Document +
 * Attestation machinery, the same shape as ORG_PAGE_VERIFIED in
 * dal/attestation.ts, rather than a bespoke application table: upload
 * legitimacy documents here, staff reviews them on the existing
 * Documents admin screen, then approveHandleApplication stamps the
 * HANDLE_APPLICATION_APPROVED attestation the handle preview/confirm
 * functions require.
 *
 * Filed on the org's own Party, either from the org's own workspace or
 * from an officer's personal account — assertBusinessOfficer is the
 * same "am I entitled to act for this org" check
 * issueBusinessEsoqoPaymentId already uses, so both paths work
 * identically; there is nothing here specific to which account the
 * caller is signed into.
 */

export interface HandleApplicationDocumentInput {
  title: string;
  kind: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Uploads the legitimacy documents an application is reviewed against.
 *  Deliberately not routed through dal/documents.ts's createDocument:
 *  that function's capability check requires document.write scoped to
 *  the caller's own party, which an officer acting for their business
 *  doesn't hold — assertBusinessOfficer is the correct authorisation
 *  question here instead ("may this caller act for this org"), so the
 *  same validation createDocument does is repeated against that gate. */
export async function applyForBusinessHandle(
  ctx: Ctx, orgPartyId: string, documents: HandleApplicationDocumentInput[],
) {
  await assertBusinessOfficer(ctx, orgPartyId);
  if (documents.length === 0) {
    throw new Error('At least one legitimacy document is required');
  }

  const created = [];
  for (const doc of documents) {
    if (!(doc.mimeType in ALLOWED_TYPES)) throw new Error(`We cannot accept ${doc.mimeType} files`);
    if (doc.sizeBytes > MAX_BYTES) throw new Error('That file is larger than 10 MB');

    const dupe = await prisma.document.findFirst({
      where: { sha256: doc.sha256, deletedAt: null, partyId: orgPartyId },
    });
    if (dupe) {
      created.push(dupe);
      continue;
    }

    created.push(await prisma.document.create({
      data: {
        partyId: orgPartyId,
        title: doc.title.trim().slice(0, 160),
        kind: doc.kind,
        storageKey: doc.storageKey,
        originalName: doc.originalName.slice(0, 200),
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        sha256: doc.sha256,
        uploadedByType: ctx.actorType,
        uploadedById: ctx.actorId ?? undefined,
      },
    }));
  }

  await recordAudit(ctx, {
    action: 'handle_application.submitted', targetType: 'party', targetId: orgPartyId,
    payload: { documentCount: created.length },
  });
  return created;
}

/**
 * Staff approves a submitted application after reviewing its documents
 * on the existing Documents admin screen. Mirrors issueOrgPageVerification
 * in dal/attestation.ts, but self-issued — no issuerOrgId, the same
 * shape MSISDN_VERIFIED already uses, since this is the platform
 * vouching for its own handle rather than a third-party Issuer's claim.
 * Idempotent, same reasoning as issueOrgPageVerification.
 */
export async function approveHandleApplication(ctx: Ctx, orgPartyId: string) {
  requireCapability(ctx, 'attestation.issue:HANDLE_APPLICATION_APPROVED');
  if (!ctx.actorId) throw new Error('Approving an application requires a named staff account');

  const existing = await prisma.attestation.findFirst({
    where: { subjectId: orgPartyId, claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
  });
  if (existing) return existing;

  const attestation = await prisma.attestation.create({
    data: {
      subjectId: orgPartyId,
      claimType: 'HANDLE_APPLICATION_APPROVED',
      claimValue: { approvedBy: ctx.actorId },
      issuerUserId: ctx.actorId,
      method: 'DOCUMENT',
    },
  });

  await recordAudit(ctx, {
    action: 'handle_application.approved', targetType: 'attestation', targetId: attestation.id,
    payload: { orgPartyId },
  });
  return attestation;
}

/** Revokes a previously-approved application — e.g. the credentials
 *  turn out to be forged. Mirrors revokeOrgPageVerification. Does not
 *  touch a handle already minted off the approval; that's a separate,
 *  deliberate call if it's ever needed, same as party.erase is separate
 *  from party.write. */
export async function revokeHandleApplication(ctx: Ctx, orgPartyId: string, reason: string) {
  requireCapability(ctx, 'attestation.revoke');
  const attestation = await prisma.attestation.findFirst({
    where: { subjectId: orgPartyId, claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
  });
  if (!attestation) return null;

  const revoked = await prisma.attestation.update({
    where: { id: attestation.id },
    data: { revokedAt: new Date(), revocationReason: reason },
  });
  await recordAudit(ctx, {
    action: 'handle_application.revoked', targetType: 'attestation', targetId: attestation.id,
    payload: { orgPartyId, reason },
  });
  return revoked;
}

/** Organisations with legitimacy documents on file but no approved
 *  application yet — the staff review queue for this feature. Reuses
 *  document.review, the same capability the Documents admin screen
 *  already requires to review these files. */
export async function listPendingHandleApplications(ctx: Ctx) {
  requireCapability(ctx, 'document.review');

  const orgsWithDocs = await prisma.party.findMany({
    where: {
      kind: 'ORGANISATION',
      deletedAt: null,
      organisation: { isNot: null },
      documents: { some: { deletedAt: null } },
      esoqoPaymentId: { is: null },
    },
    select: {
      id: true,
      organisation: { select: { officialName: true } },
      documents: {
        where: { deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
      },
      attestations: {
        where: { claimType: 'HANDLE_APPLICATION_APPROVED', revokedAt: null },
      },
    },
  });

  return orgsWithDocs
    .filter((org) => org.attestations.length === 0)
    .map((org) => ({
      orgPartyId: org.id,
      name: org.organisation?.officialName ?? org.id,
      documents: org.documents,
    }));
}
