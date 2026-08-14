'use server';

import { headers } from 'next/headers';
import {
  findSubjectCredential, recordSignInSuccess, recordSignInFailure, setSubjectPin, SetPinError,
  acceptPendingInvites, createJamiiInterest, JAMII_INTEREST_CREATE, type Ctx,
} from '@esoko/db';
import {
  verifyPin, hashPin, isWeakPin, issueOtp, verifyOtp, OtpError, checkRateLimit, RateLimitError,
} from '@esoko/auth';
import { signInSchema, requestPinCodeSchema, setPinSchema, jamiiInterestSchema } from '@esoko/domain';
import { startSession } from '@/lib/session';

export type ActionResult<T = void> = {
  ok: true; data: T;
} | {
  ok: false; error: string; field?: string;
  /** Set when the identifier genuinely isn't a CECF member, rather than a
   *  wrong PIN or a not-yet-set one — the UI switches to the "submit your
   *  interest" form instead of a generic retry on this signal. */
  notMember?: boolean;
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/**
 * Phone OR email + PIN — same credentials as the rest of Esoko. A
 * PUBLIC HTTP ENDPOINT wearing a function signature, mirroring
 * apps/store's actionSignIn exactly.
 */
export async function actionSignIn(raw: unknown): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  const { identifier, pin } = parsed.data;

  try {
    await checkRateLimit(`jamii-signin:${await clientIp()}`, 10, 300);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
    throw e;
  }

  const cred = await findSubjectCredential(identifier);
  if (!cred || !cred.pinHash) {
    return {
      ok: false,
      error: 'No account found, or a PIN has not been set yet. Use "Set your PIN" below.',
      field: 'identifier',
    };
  }
  if (cred.frozenAt) return { ok: false, error: 'This account is frozen. Contact CECF to unfreeze it.' };
  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    return { ok: false, error: 'Too many wrong PINs. Try again in a few minutes.' };
  }

  const valid = await verifyPin(pin, cred.pinHash);
  if (!valid) {
    await recordSignInFailure(cred.partyId);
    return { ok: false, error: 'Incorrect PIN.', field: 'pin' };
  }

  await recordSignInSuccess(cred.partyId);
  await startSession(cred.partyId);
  await acceptPendingInvites(cred.partyId);
  return { ok: true, data: { next: '/dashboard' } };
}

/**
 * Step 1 of setting/resetting a PIN — sends (or, in console mode, logs) a
 * code. Checks membership FIRST: Our Jamii only exists for people who
 * already have an Esoko Person record (created via CECF's join funnel,
 * apps/app/src/app/join) — sending an OTP to a number that will only
 * fail at the final step (see actionSetPin/setSubjectPin's NOT_FOUND)
 * wastes an SMS and a confusing round trip. `notMember: true` tells the
 * UI to offer the interest form instead of "try again."
 */
export async function actionRequestPinCode(raw: unknown): Promise<ActionResult<{ devCode?: string }>> {
  const parsed = requestPinCodeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid number' };

  const cred = await findSubjectCredential(parsed.data.msisdn);
  if (!cred) {
    return {
      ok: false,
      notMember: true,
      error: 'Our Jamii is only for CECF members, and we could not find that number on file.',
      field: 'msisdn',
    };
  }

  try {
    const result = await issueOtp(parsed.data.msisdn, 'PIN_RESET', await clientIp());
    return { ok: true, data: { devCode: result.devCode } };
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * The "not a CECF member" fallback — a lead, not a Registration (see
 * @esoko/db's createJamiiInterest for why). Anonymous by design, the
 * same shape as apps/app/src/app/join/actions.ts's requestCtx: a
 * narrowly-scoped SYSTEM Ctx that can do exactly this one write.
 */
async function anonInterestCtx(): Promise<Ctx> {
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: [JAMII_INTEREST_CREATE],
    ip: await clientIp(),
    __verified: true,
  };
}

export async function actionSubmitJamiiInterest(raw: unknown): Promise<ActionResult> {
  const parsed = jamiiInterestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Check your details', field: issue?.path[0] as string | undefined };
  }

  try {
    await createJamiiInterest(await anonInterestCtx(), parsed.data);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "That didn't go through — please try again." };
  }
}

/** Step 2 — verifies the code, sets the PIN, and signs the subject straight in. */
export async function actionSetPin(raw: unknown): Promise<ActionResult<{ next: string }>> {
  const parsed = setPinSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  const { msisdn, code, pin } = parsed.data;

  if (isWeakPin(pin)) {
    return { ok: false, error: 'Choose a less predictable PIN — not 1234, 0000 or a run of digits.', field: 'pin' };
  }

  try {
    await verifyOtp(msisdn, 'PIN_RESET', code);
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message, field: 'code' };
    throw e;
  }

  try {
    const pinHash = await hashPin(pin);
    const { partyId } = await setSubjectPin(msisdn, pinHash);
    await startSession(partyId);
    await acceptPendingInvites(partyId);
    return { ok: true, data: { next: '/dashboard' } };
  } catch (e) {
    if (e instanceof SetPinError) return { ok: false, error: e.message };
    throw e;
  }
}
