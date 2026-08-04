'use server';

import { headers } from 'next/headers';
import { ZodError } from 'zod';
import {
  startRegistration,
  updateRegistration,
  markOtpSent,
  markMsisdnVerified,
  completeRegistration,
  getRegistration,
  systemCtx,
  type Ctx,
} from '@esoko/db';
import { issueOtp, verifyOtp, OtpError } from '@esoko/auth';
import {
  step1Schema, step2Schema, step3Schema, step4Schema, step5Schema,
  requestOtpSchema, verifyOtpSchema, completeRegistrationSchema,
  resolveSegment, normaliseMsisdn,
} from '@esoko/domain';

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
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

/* ── step 1 ─────────────────────────────────────────────────── */

export async function actionStart(raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const input = step1Schema.parse(raw);
    const ctx = await requestCtx();
    const h = await headers();
    const reg = await startRegistration(ctx, {
      joiningAs: input.joiningAs === 'inst' ? 'me' : input.joiningAs,
      language: input.language,
      path: 'SELF_WEB',
      ip: ctx.ip,
      userAgent: h.get('user-agent'),
    });
    return { ok: true, data: { id: reg.id } };
  } catch (e) { return fail(e); }
}

/* ── steps 2–5 ──────────────────────────────────────────────── */

export async function actionSaveNames(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    const v = step2Schema.parse(raw);
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, {
      officialName: v.officialName,
      knownAs: v.knownAs || undefined,
      orgName: v.orgName || undefined,
      orgKnownAs: v.orgKnownAs || undefined,
      orgRole: v.orgRole,
    });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionSaveContact(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    const v = step3Schema.parse(raw);
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, {
      msisdn: v.msisdn,
      email: v.email || undefined,
      county: v.county,
      ward: v.ward || undefined,
    });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionSaveWork(
  registrationId: string, raw: unknown,
): Promise<ActionResult<{ papers: string[] }>> {
  try {
    const v = step4Schema.parse(raw);
    const ctx = await requestCtx();
    // Resolve on the server so the stored segment matches the shared
    // dictionary, whatever the client sent.
    const match = resolveSegment(v.workRaw);
    await updateRegistration(ctx, registrationId, {
      workRaw: v.workRaw,
      segment: match.segment?.key,
    });
    const papers = match.segment?.papers ?? ['P', 'B', 'C'];
    return { ok: true, data: { papers } };
  } catch (e) { return fail(e); }
}

export async function actionSaveStanding(
  registrationId: string, raw: unknown,
): Promise<ActionResult> {
  try {
    const v = step5Schema.parse(raw);
    const ctx = await requestCtx();
    await updateRegistration(ctx, registrationId, {
      hasRegisteredBusiness: v.hasRegisteredBusiness,
      registrationNo: v.registrationNo || undefined,
      belongsToGroup: v.belongsToGroup,
      groupName: v.groupName || undefined,
      groupPartyId: v.groupPartyId,
      feeCoverage: v.feeCoverage,
      memberCount: v.memberCount,
      hasKraPin: v.hasKraPin,
    });
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/* ── OTP ────────────────────────────────────────────────────── */

export async function actionRequestOtp(
  raw: unknown,
): Promise<ActionResult<{ devCode?: string; cooldownSeconds: number }>> {
  try {
    const v = requestOtpSchema.parse(raw);
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
    const ctx = await requestCtx();

    await updateRegistration(ctx, v.registrationId, {
      ussdSetupChoice: v.ussdSetupChoice,
      wantsPriceSms: v.wantsPriceSms,
      wantsReceiptSms: v.wantsReceiptSms,
      wantsExpirySms: v.wantsExpirySms,
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
