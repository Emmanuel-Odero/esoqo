'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { TICKETING_STAFF_CAPABILITIES, type TicketingStaffRole } from '@esoqo/db';
import { ticketOrgStaffSignInSchema, clientIpFrom } from '@esoqo/domain';
import { checkRateLimit, RateLimitError } from '@esoqo/auth';
import { createTicketStaffSession } from '@/lib/session';
import { goUrl } from '@/lib/ticketing';

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Same message whether the name didn't match or the PIN was wrong —
 *  telling those apart is exactly what lets an attacker enumerate
 *  staff names one guess at a time. core-go's sign-in holds the same
 *  contract (DummyPinHash on miss). */
const BAD_CREDENTIALS = 'Name or PIN is incorrect';

/**
 * A public, unauthenticated PIN check — rate-limited per org+name AND
 * per IP, same shape as apps/store's cashierSignIn. The credential
 * check itself now happens in core-go (POST /v1/ticket-staff/sign-in,
 * same Redis session format); this action only rate-limits, forwards,
 * and plants the staff cookie for the console.
 */
export async function ticketStaffSignIn(orgSlug: string, raw: unknown): Promise<SignInResult> {
  const parsed = ticketOrgStaffSignInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  const h = await headers();
  const ip = clientIpFrom((n) => h.get(n)) ?? 'unknown';
  const nameKey = parsed.data.name.trim().toLowerCase();

  try {
    await checkRateLimit(`ticket-staff-signin:${orgSlug}:${nameKey}`, 6, 900);
    await checkRateLimit(`ticket-staff-signin-org:${orgSlug}`, 30, 900);
    await checkRateLimit(`ticket-staff-signin-ip:${ip}`, 20, 900);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many attempts — try again in a few minutes' };
    throw e;
  }

  let res: Response;
  try {
    res = await fetch(goUrl('/v1/ticket-staff/sign-in'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgSlug, name: parsed.data.name, pin: parsed.data.pin }),
      cache: 'no-store',
    });
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'Could not reach the sign-in service. Try again.' };
  }
  if (!res.ok) return { ok: false, error: BAD_CREDENTIALS };

  const json = (await res.json().catch(() => null)) as {
    token?: string; orgId?: string; role?: string; name?: string;
  } | null;
  if (!json?.token || !json.orgId) return { ok: false, error: BAD_CREDENTIALS };

  const role: TicketingStaffRole =
    json.role === 'ADMIN' || json.role === 'MANAGER' ? json.role : 'SCANNER';
  // NOTE: the session is minted by core-go (returned token); the cookie
  // planted here only carries that bearer. Capabilities stay frozen in
  // the Go session per TICKETING_STAFF_CAPABILITIES — the spread below
  // is for the cookie record shape, not a grant.
  await createTicketStaffSession({
    staffId: '', orgId: json.orgId,
    capabilities: [...TICKETING_STAFF_CAPABILITIES[role]],
  }, json.token);

  redirect(`/org/${json.orgId}`);
}
