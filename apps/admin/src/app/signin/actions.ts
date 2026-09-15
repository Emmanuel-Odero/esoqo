'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { findStaffCredential, recordStaffSignInSuccess, recordStaffSignInFailure } from '@esoqo/db';
import { verifyPin, createSession, SESSION_COOKIE } from '@esoqo/auth';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export async function signIn(_prev: unknown, data: FormData): Promise<SignInResult> {
  const email = (data.get('email') as string ?? '').trim().toLowerCase();
  const pin = (data.get('pin') as string ?? '').trim();

  if (!email || !pin) return { ok: false, error: 'Email and PIN are required.' };

  const staff = await findStaffCredential(email);
  if (!staff) return { ok: false, error: 'No account found with that email.', field: 'email' };
  if (!staff.active) return { ok: false, error: 'This account has been deactivated.' };
  if (staff.suspendedAt) return { ok: false, error: 'This account is suspended.' };
  if (staff.lockedUntil && staff.lockedUntil > new Date()) {
    return { ok: false, error: 'Account is temporarily locked. Try again later.' };
  }

  const valid = await verifyPin(pin, staff.pinHash);
  if (!valid) {
    await recordStaffSignInFailure(staff.id);
    return { ok: false, error: 'Incorrect PIN.', field: 'pin' };
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

  redirect('/');
}
