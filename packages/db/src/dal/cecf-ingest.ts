import type { MemberRole } from '@prisma/client';
import { type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { getRegistration, completeRegistration } from './registration';
import { addNewMember } from './groups';
import { setTreasuryPolicy, TreasuryError } from './treasury';
import { createDocument } from './documents';
import {
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
} from '../storage';
import type { CecfMember, CecfDocumentUpload } from '@esoqo/domain';

/**
 * Orchestration for the CECF WordPress → esoqo ingestion facade
 * (services/core's /api/cecf/* routes). See
 * docs/proposals/cecf-wordpress-registration.md.
 *
 * Deliberately thin: startRegistration/updateRegistration/
 * completeRegistration are called directly by the routes, unchanged —
 * this module only holds the two pieces of logic that are genuinely new
 * to CECF ingestion and don't belong in registration.ts itself: adding a
 * group's member roster once its Organisation exists, and — best-effort —
 * configuring a per-member join fee.
 */

/**
 * A trusted service account, not an anonymous joiner. actorType: 'STAFF'
 * is what actually matters here — it's what lets addNewMember (via
 * requireGroupOfficer's `if (ctx.actorType === 'STAFF') return;` bypass)
 * act on a brand-new group without the caller needing to already be one
 * of its officers, the same trust level any other staff-facing admin
 * tool in this codebase already carries. capabilities: ['*'] mirrors
 * systemCtx() in packages/db/src/capabilities.ts; unlike systemCtx this
 * can also carry a partyId, needed below for setTreasuryPolicy.
 */
function cecfServiceCtx(partyId?: string): Ctx {
  return {
    actorType: 'STAFF',
    actorId: 'system:cecf-ingest',
    capabilities: ['*'],
    partyId,
    __verified: true,
  };
}

const ROLE_TO_ORG_ROLE: Record<string, string> = {
  CHAIRPERSON: 'chairperson', TREASURER: 'treasurer', SECRETARY: 'secretary', MEMBER: 'member',
};

/** What completeRegistration's toMemberRole() expects on Registration.orgRole,
 *  derived from the CECF payload's registrantRole. */
export function cecfRegistrantOrgRole(registrantRole: string): string {
  return ROLE_TO_ORG_ROLE[registrantRole] ?? 'member';
}

/**
 * Adds a group's member roster (everyone beyond the registering founder,
 * who completeRegistration already added). Each member lands as PENDING
 * or ACTIVE depending on the group's join-fee policy — see
 * resolveJoinStatus in groups.ts — so a member with an unpaid KES 500
 * fee shows up immediately but can't yet act as one until they (or the
 * group) settle it, same as any self-serve invite.
 *
 * Best-effort per member: one malformed row (e.g. a clashing phone
 * number already on Esoqo) is logged and skipped rather than aborting
 * the whole roster — the registration and the group both already exist
 * by the time this runs, so a partial roster is far better than losing
 * the group entirely over one bad row.
 */
export async function addCecfMemberRoster(
  orgPartyId: string, members: CecfMember[],
): Promise<{ added: number; skipped: { member: CecfMember; reason: string }[] }> {
  const ctx = cecfServiceCtx();
  let added = 0;
  const skipped: { member: CecfMember; reason: string }[] = [];

  for (const member of members) {
    try {
      await addNewMember(
        ctx, orgPartyId,
        { officialName: member.officialName, msisdn: member.msisdn },
        member.role as MemberRole, member.customRole,
      );
      added += 1;
    } catch (e) {
      skipped.push({ member, reason: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  await recordAudit(ctx, {
    action: 'cecf.member_roster_ingested', targetType: 'organisation', targetId: orgPartyId,
    payload: { requested: members.length, added, skipped: skipped.length },
  });

  return { added, skipped };
}

/**
 * Best-effort: sets GroupTreasuryPolicy.joinFeeKes so future members
 * default to PENDING until they pay their own KES 500 (see
 * resolveJoinStatus). setTreasuryPolicy hard-requires the caller to
 * already be one of the group's own officers — no staff bypass exists
 * for it, unlike addNewMember above, because treasury policy is
 * deliberately member-governed, not admin-overridable. That's only true
 * here when the registering founder chose an officer role
 * (registrantRole — see cecfRegistrantOrgRole); if they registered as a
 * plain member, this quietly does nothing rather than failing the whole
 * registration — a CECF officer can set the join fee later from the
 * group's own /me/group/[orgId]/treasury screen once one exists.
 */
export async function trySetCecfJoinFee(
  founderPartyId: string, orgPartyId: string, joinFeeKes: number,
): Promise<boolean> {
  const ctx = cecfServiceCtx(founderPartyId);
  try {
    await setTreasuryPolicy(ctx, orgPartyId, { joinFeeKes });
    return true;
  } catch (e) {
    if (e instanceof TreasuryError && e.code === 'NOT_AN_OFFICER') {
      await recordAudit(cecfServiceCtx(), {
        action: 'cecf.join_fee_not_set', targetType: 'organisation', targetId: orgPartyId,
        payload: { reason: 'registrant_not_an_officer', joinFeeKes },
      });
      return false;
    }
    throw e;
  }
}

/** KES 500 per person — the group registration fee named throughout the
 *  CECF registration spec. Not user-configurable at ingest time; a CECF
 *  officer can change a specific group's joinFeeKes afterwards from its
 *  own treasury screen if it ever needs to differ. */
export const CECF_JOIN_FEE_KES = 500;

/**
 * Runs completeRegistration, then — for a group registration whose
 * feeCoverage was saved as 'self' (read straight off the Registration
 * row, not re-supplied by the caller) — the two CECF-specific follow-ups
 * above. One call for services/core's
 * /api/cecf/registration/:id/complete route.
 */
export async function completeCecfRegistration(
  registrationId: string,
  input: { members?: CecfMember[] } = {},
) {
  const ctx = cecfServiceCtx();
  const reg = await getRegistration(ctx, registrationId);
  const result = await completeRegistration(ctx, registrationId);

  if (result.orgPartyId && reg?.feeCoverage === 'self') {
    await trySetCecfJoinFee(result.partyId, result.orgPartyId, CECF_JOIN_FEE_KES);
  }

  let roster: Awaited<ReturnType<typeof addCecfMemberRoster>> | null = null;
  if (result.orgPartyId && input.members?.length) {
    roster = await addCecfMemberRoster(result.orgPartyId, input.members);
  }

  return { ...result, roster };
}

/**
 * Decodes and stores one CECF-collected file (cert, member list, photo)
 * against the funnel record — same primitives apps/app/join/upload.ts
 * uses for the browser-upload path, just fed a base64 buffer instead of
 * a multipart File since WordPress already has the bytes server-side.
 */
export async function uploadCecfDocument(registrationId: string, doc: CecfDocumentUpload) {
  const reg = await getRegistration(cecfServiceCtx(), registrationId);
  if (!reg) throw new Error('Registration not found');

  const buf = Buffer.from(doc.base64, 'base64');
  if (buf.length > MAX_BYTES) throw new Error('That file is larger than 10 MB');

  const check = sniff(buf, doc.mimeType, doc.originalName);
  if (!check.ok || !check.mime) throw new Error(check.reason ?? 'We cannot accept that file');

  const storageKey = makeStorageKey(check.mime);
  await putObject(storageKey, buf);

  return createDocument(cecfServiceCtx(), {
    registrationId, title: doc.title, kind: doc.kind, storageKey,
    originalName: safeName(doc.originalName),
    mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
  });
}
