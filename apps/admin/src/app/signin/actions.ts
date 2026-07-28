'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@esoko/db';
import { verifyPin, createSession, SESSION_COOKIE } from '@esoko/auth';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export async function signIn(_prev: unknown, data: FormData): Promise<SignInResult> {
  const email = (data.get('email') as string ?? '').trim().toLowerCase();
  const pin = (data.get('pin') as string ?? '').trim();

  if (!email || !pin) return { ok: false, error: 'Email and PIN are required.' };

  const staff = await prisma.staffUser.findUnique({ where: { email } });
  if (!staff) return { ok: false, error: 'No account found with that email.', field: 'email' };
  if (!staff.active) return { ok: false, error: 'This account has been deactivated.' };
  if (staff.suspendedAt) return { ok: false, error: 'This account is suspended.' };
  if (staff.lockedUntil && staff.lockedUntil > new Date()) {
    return { ok: false, error: 'Account is temporarily locked. Try again later.' };
  }

  const valid = await verifyPin(pin, staff.pinHash);
  if (!valid) {
    await prisma.staffUser.update({
      where: { id: staff.id },
      data: { failedAttempts: { increment: 1 } },
    });
    return { ok: false, error: 'Incorrect PIN.', field: 'pin' };
  }

  await prisma.staffUser.update({
    where: { id: staff.id },
    data: { failedAttempts: 0, lastSeenAt: new Date() },
  });

  const token = await createSession({
    actorType: 'STAFF',
    actorId: staff.id,
    capabilities: staff.capabilities as string[],
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
