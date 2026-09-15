'use server';

import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE, checkRateLimit, RateLimitError } from '@esoqo/auth';
import { signInSchema, requestPinCodeSchema, setPinSchema, clientIpFrom } from '@esoqo/domain';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((n) => h.get(n)) ?? 'unknown';
}

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

/**
 * Subject OTP/PIN/session now live in services/core-go — see
 * docs/adr/0005-mobile-api-in-go.md — so this app, apps/store and the
 * mobile client all share one implementation instead of each carrying
 * their own copy of findSubjectCredential/recordSignInSuccess/
 * recordSignInFailure/setSubjectPin (packages/db/src/dal/auth-credential.ts)
 * and issueOtp/verifyOtp for the PIN_RESET purpose (packages/auth/src/otp.ts).
 * Session *validation* is unchanged (packages/auth/src/session.ts's
 * ctxFromToken, via apps/app/src/lib/session.ts) — core-go writes to the
 * same Redis, in the same format, so nothing downstream of sign-in needed
 * to change.
 */
async function coreGoFetch<T>(path: string, body: unknown): Promise<
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string }
> {
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code ?? 'UNKNOWN',
      message: json?.error?.message ?? 'Something went wrong',
    };
  }
  return { ok: true, data: json as T };
}

async function startSessionFromToken(token: string) {
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
 * registered. The credential check itself, and the anti-enumeration
 * DUMMY_PIN_HASH comparison, now happen in core-go — see
 * internal/httpapi/handlers_auth.go's handleSignIn.
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

  const result = await coreGoFetch<{ token: string }>('/v1/auth/sign-in', { identifier, pin });
  if (!result.ok) {
    if (result.code === 'ACCOUNT_FROZEN') return { ok: false, error: result.message };
    return { ok: false, error: result.message, field: 'identifier' };
  }

  await startSessionFromToken(result.data.token);
  return { ok: true, data: { next: '/dashboard' } };
}

/**
 * Step 1 of setting/resetting a PIN — sends (or, in console mode, logs to
 * the terminal; in mock mode, sends to the local mock-sms catcher) a code.
 */
export async function actionRequestPinCode(raw: unknown): Promise<ActionResult> {
  const parsed = requestPinCodeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid number' };

  const result = await coreGoFetch('/v1/auth/otp', { msisdn: parsed.data.msisdn, purpose: 'PIN_RESET' });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, data: undefined };
}

/** Step 2 — verifies the code, sets the PIN, and signs the subject straight in. */
export async function actionSetPin(raw: unknown): Promise<ActionResult<{ next: string }>> {
  const parsed = setPinSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  const { msisdn, code, pin } = parsed.data;

  const result = await coreGoFetch<{ token: string }>('/v1/auth/pin/reset', { msisdn, code, pin });
  if (!result.ok) {
    const field = result.code === 'WRONG_CODE' || result.code === 'EXPIRED' || result.code === 'TOO_MANY_ATTEMPTS'
      ? 'code' : result.code === 'WEAK_PIN' ? 'pin' : undefined;
    return { ok: false, error: result.message, field };
  }

  await startSessionFromToken(result.data.token);
  return { ok: true, data: { next: '/dashboard' } };
}
