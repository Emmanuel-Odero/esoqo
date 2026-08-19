'use server';

import { headers } from 'next/headers';
import {
  findSubjectCredential, recordSignInSuccess, recordSignInFailure, setSubjectPin, SetPinError,
  acceptPendingInvites, hasJamiiAccess,
} from '@esoko/db';
import {
  verifyPin, hashPin, isWeakPin, issueOtp, verifyOtp, OtpError, checkRateLimit, RateLimitError,
} from '@esoko/auth';
import { signInSchema, requestPinCodeSchema, setPinSchema } from '@esoko/domain';
import { startSession } from '@/lib/session';

export type ActionResult<T = void> = {
  ok: true; data: T;
} | {
  ok: false; error: string; field?: string;
  /** Set when there is no Our Jamii access yet for this identifier —
   *  either genuinely unknown, or known but not yet approved (see
   *  `matched`). The UI sends either case to /apply instead of a
   *  generic retry. */
  notMember?: boolean;
  /** Only meaningful alongside notMember: true — an existing CECF/Esoko
   *  Person was found, just not yet approved for Our Jamii, so /apply
   *  can skip straight to the lightweight "we found you" confirmation
   *  instead of the full application form. */
  matched?: boolean;
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/**
 * Phone OR email + PIN — same credentials as the rest of Esoko. A
 * PUBLIC HTTP ENDPOINT wearing a function signature, mirroring
 * apps/store's actionSignIn exactly.
 *
 * hasJamiiAccess is checked here too, not just before an OTP is issued
 * — the PIN itself is one shared Esoko credential (see UserCredential),
 * so someone could have set it through CECF's own join funnel in
 * apps/app without ever going through /apply. A correct PIN alone must
 * never be enough to reach the Our Jamii dashboard.
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

  if (!(await hasJamiiAccess(cred.partyId))) {
    return {
      ok: false,
      error: 'Your Our Jamii application is still awaiting review. We will let you know once it is approved.',
    };
  }

  await recordSignInSuccess(cred.partyId);
  await startSession(cred.partyId);
  await acceptPendingInvites(cred.partyId);
  return { ok: true, data: { next: '/dashboard' } };
}

/**
 * Step 1 of setting/resetting a PIN — sends (or, in console mode, logs) a
 * code. Checks Our Jamii access FIRST: an OTP that only fails at the
 * final step (see actionSetPin below) wastes an SMS and a confusing
 * round trip, whether the identifier is a genuine stranger or an
 * existing member who just hasn't been approved for Our Jamii yet.
 * `notMember: true` tells the UI to send them to /apply instead of
 * "try again"; `matched` tells /apply whether to skip the full form.
 */
export async function actionRequestPinCode(raw: unknown): Promise<ActionResult> {
  const parsed = requestPinCodeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid number' };

  const cred = await findSubjectCredential(parsed.data.msisdn);
  if (!cred) {
    return {
      ok: false,
      notMember: true,
      matched: false,
      error: 'We could not find that number on file.',
      field: 'msisdn',
    };
  }
  if (!(await hasJamiiAccess(cred.partyId))) {
    return {
      ok: false,
      notMember: true,
      matched: true,
      error: 'We have your details, but Our Jamii access has not been approved yet.',
      field: 'msisdn',
    };
  }

  try {
    await issueOtp(parsed.data.msisdn, 'PIN_RESET', await clientIp());
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Step 2 — verifies the code, sets the PIN, and signs the subject straight in.
 *  Reachable only once actionRequestPinCode has already confirmed Our
 *  Jamii access, so no second hasJamiiAccess check is needed here. */
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
