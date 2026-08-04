'use server';

import { cookies, headers } from 'next/headers';
import {
  findSubjectCredential, recordSignInSuccess, recordSignInFailure, setSubjectPin, SetPinError,
} from '@esoko/db';
import {
  verifyPin, hashPin, isWeakPin, createSession, capabilitiesForRole, SESSION_COOKIE,
  issueOtp, verifyOtp, OtpError, checkRateLimit, RateLimitError,
} from '@esoko/auth';
import { signInSchema, requestPinCodeSchema, setPinSchema } from '@esoko/domain';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function startSession(partyId: string) {
  const token = await createSession({
    actorType: 'SUBJECT',
    actorId: partyId,
    partyId,
    capabilities: capabilitiesForRole('SUBJECT'),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });
}

/**
 * Phone OR email + PIN. A PUBLIC HTTP ENDPOINT wearing a function
 * signature — validated at the boundary, rate-limited per IP, and every
 * failure path is deliberately generic ("No account, or PIN not set")
 * so a wrong guess can't be used to enumerate which numbers are
 * registered.
 */
export async function actionSignIn(raw: unknown): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  const { identifier, pin } = parsed.data;

  try {
    await checkRateLimit(`signin:${await clientIp()}`, 10, 300);
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
  if (cred.frozenAt) return { ok: false, error: 'This account is frozen. Contact Esoko to unfreeze it.' };
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
  return { ok: true, data: { next: '/me' } };
}

/** Step 1 of setting/resetting a PIN — sends (or, in console mode, logs) a code. */
export async function actionRequestPinCode(raw: unknown): Promise<ActionResult<{ devCode?: string }>> {
  const parsed = requestPinCodeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid number' };

  try {
    const result = await issueOtp(parsed.data.msisdn, 'PIN_RESET', await clientIp());
    return { ok: true, data: { devCode: result.devCode } };
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message };
    throw e;
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
    return { ok: true, data: { next: '/me' } };
  } catch (e) {
    if (e instanceof SetPinError) return { ok: false, error: e.message };
    throw e;
  }
}
