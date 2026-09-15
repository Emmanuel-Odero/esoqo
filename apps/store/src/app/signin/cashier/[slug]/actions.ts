'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { getCashierPinHashForSignIn, CASHIER_CAPABILITIES, type CashierRole } from '@esoqo/db';
import { cashierSignInSchema, clientIpFrom } from '@esoqo/domain';
import { verifyPin, checkRateLimit, RateLimitError, DUMMY_PIN_HASH } from '@esoqo/auth';
import { createCashierSession, destroyCashierSession } from '@/lib/session';

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Same message whether the name didn't match or the PIN was wrong —
 *  telling those apart is exactly what lets an attacker enumerate staff
 *  names one guess at a time. */
const BAD_CREDENTIALS = 'Name or PIN is incorrect';

/**
 * A public, unauthenticated PIN check — the exact kind of thing that
 * gets brute-forced, so it's rate-limited per store+name AND per IP,
 * same shape as OTP's guard in @esoqo/auth/otp.ts. The name isn't
 * picked from a list (see the DAL doc comment) and a bad name always
 * takes the same branch, in the same time, as a bad PIN.
 */
export async function cashierSignIn(storeSlug: string, raw: unknown): Promise<SignInResult> {
  const parsed = cashierSignInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n)) ?? 'unknown';
  const nameKey = parsed.data.name.trim().toLowerCase();

  try {
    // Per store+name AND per store (name-agnostic) — the second one is
    // what stops an attacker from sidestepping the first by simply
    // trying a different guessed name on every request.
    await checkRateLimit(`cashier-signin:${storeSlug}:${nameKey}`, 6, 900);
    await checkRateLimit(`cashier-signin-store:${storeSlug}`, 30, 900);
    await checkRateLimit(`cashier-signin-ip:${ip}`, 20, 900);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many attempts — try again in a few minutes' };
    throw e;
  }

  const cashier = await getCashierPinHashForSignIn(storeSlug, parsed.data.name);
  // No match → verify against a dummy hash anyway, so this branch costs
  // the same wall-clock time as a real PIN check.
  const valid = await verifyPin(parsed.data.pin, cashier?.pinHash ?? DUMMY_PIN_HASH);
  if (!cashier || !valid) return { ok: false, error: BAD_CREDENTIALS };

  const role: CashierRole = cashier.role === 'MANAGER' ? 'MANAGER' : 'CASHIER';
  await createCashierSession({
    cashierId: cashier.id, storeId: cashier.storeId,
    capabilities: [...CASHIER_CAPABILITIES[role]],
  });

  redirect('/dashboard/pos');
}

export async function cashierSignOut(storeSlug: string): Promise<void> {
  await destroyCashierSession();
  // Genuinely dynamic — typedRoutes can only validate this once its
  // manifest has seen the [slug] page compile at least once.
  redirect(`/signin/cashier/${storeSlug}` as Route);
}
