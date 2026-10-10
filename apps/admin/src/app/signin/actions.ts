'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFrom } from '@esoqo/domain';
import { findStaffCredential, recordStaffSignInSuccess, recordStaffSignInFailure } from '@esoqo/db';
import {
  verifyPin, createSession, SESSION_COOKIE, DUMMY_PIN_HASH, checkRateLimit, RateLimitError,
} from '@esoqo/auth';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((n) => h.get(n)) ?? 'unknown';
}

// The generic "No account, or a PIN has not been set" error used
// throughout (identical to apps/app's subject sign-in) — distinguishing
// "no account" from "wrong PIN" is a staff-account enumeration oracle,
// and skipping verifyPin on a miss turns that into a timing oracle too.
const GENERIC_ERROR = 'No account found, or that PIN is not right.';

export async function signIn(_prev: unknown, data: FormData): Promise<SignInResult> {
  const email = (data.get('email') as string ?? '').trim().toLowerCase();
  const pin = (data.get('pin') as string ?? '').trim();

  if (!email || !pin) return { ok: false, error: 'Email and PIN are required.' };

  try {
    await checkRateLimit(`admin-signin:${await clientIp()}`, 10, 300);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
    }
    throw e;
  }

  const staff = await findStaffCredential(email);

  if (!staff || !staff.active || staff.suspendedAt
    || (staff.lockedUntil && staff.lockedUntil > new Date())) {
    // Still runs a full Argon2id verify against a dummy hash so a
    // nonexistent/deactivated/locked account takes the same wall-clock
    // time as a wrong PIN against a real one — see pin.ts's DUMMY_PIN_HASH.
    await verifyPin(pin, DUMMY_PIN_HASH);
    return { ok: false, error: GENERIC_ERROR, field: 'pin' };
  }

  const valid = await verifyPin(pin, staff.pinHash);
  if (!valid) {
    await recordStaffSignInFailure(staff.id);
    return { ok: false, error: GENERIC_ERROR, field: 'pin' };
  }

  await recordStaffSignInSuccess(staff.id);

  const token = await createSession({
    actorType: 'STAFF',
    actorId: staff.id,
    capabilities: staff.capabilities,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });

  // A fresh invite (or an admin-forced reset) leaves this true — the
  // temp PIN the invite email carried gets them signed in, but not
  // past this, until they've actually chosen their own.
  redirect(staff.mustChangePin ? '/set-pin' : '/');
}
