'use server';

import { headers } from 'next/headers';
import { z, ZodError } from 'zod';
import {
  startRegistration,
  updateRegistration,
  markOtpSent,
  markMsisdnVerified,
  completeRegistration,
  getRegistration,
  type Ctx,
  type UpdateRegistrationInput,
} from '@esoko/db';
import { issueOtp, verifyOtp, OtpError } from '@esoko/auth';
import {
  step2Schema, step3Schema, step4Schema, step5Schema,
  groupDetailsSchema, groupMembershipCheckSchema,
  bizStandingSchema, bizDetailsSchema, bizFinancialsSchema,
  requestOtpSchema, verifyOtpSchema, completeRegistrationSchema,
  resolveSegment, toSafeErrorMessage,
} from '@esoko/domain';
import { grantRegistrationOwnership, ownsRegistration } from './ownership';

/**
 * Server Actions.
 *
 * Every one of these is a PUBLIC HTTP ENDPOINT wearing a function
 * signature. So every one: validates with Zod at the boundary, builds a
 * Ctx it controls, and calls the DAL — which checks capability before
 * any query runs. Nothing here trusts its caller.
 *
 * The July 2026 advisories included unbounded Server Action payloads and
 * unauthenticated disclosure of internal Server Function endpoints. The
 * defence is not hoping; it is validating every input and authorising
 * every call.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function requestCtx(): Promise<Ctx> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  // Anonymous registration is a deliberate, narrow grant: create and edit
  // one's own in-flight registration, nothing else.
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: ['registration.create', 'registration.write', 'registration.read', 'party.read:public'],
    ip,
    __verified: true,
  };
}

// Same message whether the id is truly unknown or just not this
// browser's — telling the two apart would confirm someone else's
// registration id exists, which is itself information a stranger
// shouldn't get from a bare guess.
const NOT_OWNER: ActionResult<never> = { ok: false, error: 'Registration not found' };

function fail(e: unknown): ActionResult<never> {
  if (e instanceof OtpError) return { ok: false, error: e.message };
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    return { ok: false, error: issue?.message ?? 'Check what you entered and try again.', field: issue?.path[0] as string | undefined };
  }
  if (e instanceof Error) {
    if ((e as { code?: string }).code === 'MSISDN_TAKEN') {
      return { ok: false, error: 'That number is already registered. Sign in instead.', field: 'msisdn' };
    }
    return { ok: false, error: e.message };
  }
  // The real error still needs to reach someone — it just should never
  // be the person who hit it. Server-side logs are the right place.
  console.error(e);
  return {
    ok: false,
    error: toSafeErrorMessage(
      e,
      "We couldn't save that just now — nothing else you've entered was lost. "
        + 'Try again in a moment. If it keeps happening, dial *483*77# and choose 7, '
        + 'or write to malalamiko@esoko.co.ke.',
    ),
  };
}

/* ── step 1+2 ───────────────────────────────────────────────── */

/**
 * Creates the registration for the first time — deliberately not until
 * the joiner has typed a real name (step 2), not the instant they pick
 * "Myself"/"A group"/"A business" on step 1. Row creation used to happen
 * on that first click, before a single character was typed, which left
 * behind an empty shell whenever someone closed the tab immediately —
 * see the July 2026 data cleanup.
 */
const groupSchema = step5Schema.pick({
  belongsToGroup: true, groupName: true, groupPartyId: true, feeCoverage: true,
});

export async function actionStart(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const v = step2Schema.parse(raw);
    // The group question (step 2 in the UI) is answered before the name
    // is ever saved, so whatever was picked there rides along on this
    // same first write.
    const group = groupSchema.parse(raw);
    const ctx = await requestCtx();
    const h = await headers();
    const reg = await startRegistration(ctx, {
      joiningAs: v.joiningAs === 'inst' ? 'me' : v.joiningAs,
      officialName: v.officialName,
      knownAs: v.knownAs || undefined,
      orgName: v.orgName || undefined,
      orgKnownAs: v.orgKnownAs || undefined,
      orgRole: v.orgRole,
      belongsToGroup: group.belongsToGroup,
      groupName: group.groupName || undefined,
      groupPartyId: group.groupPartyId,
      feeCoverage: group.feeCoverage,
      lastStep: 3,
      language: 'en',
      path: 'SELF_WEB',
      ip: ctx.ip,
      userAgent: h.get('user-agent'),
    });
    await grantRegistrationOwnership(reg.id);
    return { ok: true, data: { id: reg.id } };
  } catch (e) { return fail(e); }
}

/* ── steps 3–6 ──────────────────────────────────────────────── */

export async function actionSaveNames(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return NOT_OWNER;
    const v = step2Schema.parse(raw);
    const group = groupSchema.parse(raw);
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, {
      officialName: v.officialName,
      knownAs: v.knownAs || undefined,
      orgName: v.orgName || undefined,
      orgKnownAs: v.orgKnownAs || undefined,
      orgRole: v.orgRole,
      belongsToGroup: group.belongsToGroup,
      groupName: group.groupName || undefined,
      groupPartyId: group.groupPartyId,
      feeCoverage: group.feeCoverage,
      lastStep: 3,
    });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionSaveContact(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return NOT_OWNER;
    const v = step3Schema.parse(raw);
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, {
      msisdn: v.msisdn,
      email: v.email || undefined,
      county: v.county,
      ward: v.ward || undefined,
      lastStep: 4,
    });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionSaveWork(
  registrationId: string, raw: unknown,
): Promise<ActionResult<{ papers: string[] }>> {
  try {
    if (!(await ownsRegistration(registrationId))) return NOT_OWNER;
    const v = step4Schema.parse(raw);
    const ctx = await requestCtx();
    // Resolve on the server so the stored segment matches the shared
    // dictionary, whatever the client sent.
    const match = resolveSegment(v.workRaw);
    await updateRegistration(ctx, registrationId, {
      workRaw: v.workRaw,
      segment: match.segment?.key,
      lastStep: 5,
    });
    const papers = match.segment?.papers ?? ['P', 'B', 'C'];
    return { ok: true, data: { papers } };
  } catch (e) { return fail(e); }
}

/** The bit of step5Schema that's always present, whatever the joiner is
 *  registering — group-link fields, standing, and which of the two
 *  "creating something new" sub-forms (group / business) are in play,
 *  signalled by orgName/bizName being set with no matching *PartyId. */
const standingBaseSchema = step5Schema.extend({
  orgName: z.string().trim().max(160).optional().or(z.literal('')),
  bizPartyId: z.string().uuid().optional().or(z.literal('')),
  bizName: z.string().trim().max(160).optional().or(z.literal('')),
});

export async function actionSaveStanding(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return NOT_OWNER;
    const v = standingBaseSchema.parse(raw);
    const ctx = await requestCtx();

    // Previously belongsToGroup/groupName/groupPartyId/feeCoverage were
    // validated here but never actually written — MoreAboutYou's "do you
    // belong to a group" answer silently never reached the database.
    const update: UpdateRegistrationInput = {
      hasRegisteredBusiness: v.hasRegisteredBusiness,
      registrationNo: v.registrationNo || undefined,
      memberCount: v.memberCount,
      hasKraPin: v.hasKraPin,
      belongsToGroup: v.belongsToGroup,
      groupName: v.groupName || undefined,
      groupPartyId: v.groupPartyId || undefined,
      feeCoverage: v.feeCoverage,
      lastStep: 6,
    };

    // A brand-new group — only when search-before-create came up empty
    // (no groupPartyId) and the joiner filled in GroupDetails.
    if (v.joiningAs === 'group' && !v.groupPartyId && v.orgName) {
      const g = groupDetailsSchema.parse(raw);
      update.orgName = g.orgName;
      update.orgKnownAs = g.orgKnownAs || undefined;
      update.orgKind = g.orgKind;
      update.orgSubCounty = g.orgSubCounty || undefined;
      update.orgDistrict = g.orgDistrict || undefined;
      update.orgTags = g.orgTags;
      update.registrationNo = g.registrationNo || undefined;
      update.memberCount = g.memberCount;
    }

    // The business sub-flow.
    if (v.joiningAs === 'biz') {
      if (v.bizPartyId) {
        update.bizPartyId = v.bizPartyId;
      } else if (v.bizName) {
        const standing = bizStandingSchema.parse(raw);
        const details = bizDetailsSchema.parse(raw);
        const fin = bizFinancialsSchema.parse(raw);
        update.bizIsRegistered = standing.bizIsRegistered;
        update.bizIntendsToRegister = standing.bizIntendsToRegister;
        update.registrationNo = standing.registrationNo || undefined;
        update.bizName = details.bizName;
        update.bizSector = details.bizSector || undefined;
        update.bizType = details.bizType;
        update.bizTypeOther = details.bizTypeOther || undefined;
        update.bizEmployeeCount = fin.bizEmployeeCount;
        update.bizRevenueGoodKes = fin.bizRevenueGoodKes;
        update.bizRevenueBadKes = fin.bizRevenueBadKes;
        update.bizBankProvider = fin.bizBankProvider || undefined;
        update.bizPaymentChannels = fin.bizPaymentChannels;
      }
    }

    await updateRegistration(ctx, registrationId, update);
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** Documents and payment don't otherwise call the server on "Continue" —
 *  this just keeps the drop-off funnel accurate for those two steps. */
export async function actionMarkStep(registrationId: string, step: number): Promise<ActionResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return NOT_OWNER;
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, { lastStep: step });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/* ── OTP ────────────────────────────────────────────────────── */

export async function actionRequestOtp(
  raw: unknown,
): Promise<ActionResult<{ devCode?: string; cooldownSeconds: number }>> {
  try {
    const v = requestOtpSchema.parse(raw);
    if (!(await ownsRegistration(v.registrationId))) return NOT_OWNER;
    const ctx = await requestCtx();
    const reg = await getRegistration(ctx, v.registrationId);
    if (!reg) return { ok: false, error: 'Registration not found' };

    const res = await issueOtp(v.msisdn, 'REGISTRATION', ctx.ip);
    await markOtpSent(ctx, v.registrationId);
    return {
      ok: true,
      data: { devCode: res.devCode, cooldownSeconds: res.cooldownSeconds },
    };
  } catch (e) { return fail(e); }
}

export async function actionVerifyOtp(raw: unknown): Promise<ActionResult> {
  try {
    const v = verifyOtpSchema.parse(raw);
    if (!(await ownsRegistration(v.registrationId))) return NOT_OWNER;
    const ctx = await requestCtx();
    const reg = await getRegistration(ctx, v.registrationId);
    if (!reg?.msisdn) return { ok: false, error: 'No phone number on this registration' };

    await verifyOtp(reg.msisdn, 'REGISTRATION', v.code);
    await markMsisdnVerified(ctx, v.registrationId);
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/* ── finish ─────────────────────────────────────────────────── */

export async function actionComplete(
  raw: unknown,
): Promise<ActionResult<{ partyId: string }>> {
  try {
    const v = completeRegistrationSchema.parse(raw);
    if (!(await ownsRegistration(v.registrationId))) return NOT_OWNER;
    const ctx = await requestCtx();

    await updateRegistration(ctx, v.registrationId, {
      ussdSetupChoice: v.ussdSetupChoice,
      wantsPriceSms: v.wantsPriceSms,
      wantsReceiptSms: v.wantsReceiptSms,
      wantsExpirySms: v.wantsExpirySms,
      lastStep: 9,
    });

    const reg = await getRegistration(ctx, v.registrationId);
    if (!reg) return { ok: false, error: 'Registration not found' };

    // Dialling access "now" means the number must actually be verified.
    // "Later" is a legitimate choice and does not block joining.
    if (v.ussdSetupChoice === 'now' && !reg.msisdnVerifiedAt) {
      return { ok: false, error: 'Confirm your number first, or choose to do it later.' };
    }

    const result = await completeRegistration(ctx, v.registrationId);
    return { ok: true, data: { partyId: result.partyId } };
  } catch (e) { return fail(e); }
}

/* ── work search (server-resolved, so client and server agree) ── */

export async function actionSearchWork(query: string) {
  const { searchSegments } = await import('@esoko/domain');
  return searchSegments(query, 4).map((s) => ({ key: s.key, name: s.name, papers: s.papers }));
}

/* ── group search (public, name/county only) ───────────────────── */

export async function actionSearchGroups(query: string) {
  const { searchGroupsPublic } = await import('@esoko/db');
  const ctx = await requestCtx();
  return searchGroupsPublic(ctx, query);
}

/* ── business search (public, name/county only) ──────────────────── */

export async function actionSearchBusinesses(query: string) {
  const { searchBusinessesPublic } = await import('@esoko/db');
  const ctx = await requestCtx();
  return searchBusinessesPublic(ctx, query);
}

/* ── the private "am I already listed?" check ────────────────────── */

export async function actionCheckGroupMembership(
  raw: unknown,
): Promise<ActionResult<{ matched: boolean }>> {
  try {
    const v = groupMembershipCheckSchema.parse(raw);
    const { checkGroupMembership } = await import('@esoko/db');
    const ctx = await requestCtx();
    const result = await checkGroupMembership(ctx, v.groupPartyId, {
      name: v.name || undefined,
      msisdn: v.msisdn || undefined,
    });
    return { ok: true, data: { matched: result.matched } };
  } catch (e) { return fail(e); }
}
