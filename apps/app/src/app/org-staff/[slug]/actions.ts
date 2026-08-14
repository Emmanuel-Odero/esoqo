'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTicketOrgBySlug, getTicketOrgStaffForSignIn, TICKETING_STAFF_CAPABILITIES, type TicketingStaffRole } from '@esoko/db';
import { ticketOrgStaffSignInSchema } from '@esoko/domain';
import { verifyPin, checkRateLimit, RateLimitError, DUMMY_PIN_HASH } from '@esoko/auth';
import { createTicketStaffSession } from '@/lib/session';

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Same message whether the name didn't match or the PIN was wrong —
 *  telling those apart is exactly what lets an attacker enumerate
 *  staff names one guess at a time. */
const BAD_CREDENTIALS = 'Name or PIN is incorrect';

/**
 * A public, unauthenticated PIN check — rate-limited per org+name AND
 * per IP, same shape as apps/store's cashierSignIn. The name isn't
 * picked from a list (see the DAL doc comment on
 * getTicketOrgStaffForSignIn) and a bad name always takes the same
 * branch, in the same time, as a bad PIN.
 */
export async function ticketStaffSignIn(orgSlug: string, raw: unknown): Promise<SignInResult> {
  const parsed = ticketOrgStaffSignInSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const nameKey = parsed.data.name.trim().toLowerCase();

  try {
    await checkRateLimit(`ticket-staff-signin:${orgSlug}:${nameKey}`, 6, 900);
    await checkRateLimit(`ticket-staff-signin-org:${orgSlug}`, 30, 900);
    await checkRateLimit(`ticket-staff-signin-ip:${ip}`, 20, 900);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many attempts — try again in a few minutes' };
    throw e;
  }

  const org = await getTicketOrgBySlug(orgSlug);
  const staff = org ? await getTicketOrgStaffForSignIn(orgSlug, parsed.data.name) : null;
  // No match → verify against a dummy hash anyway, so this branch costs
  // the same wall-clock time as a real PIN check.
  const valid = await verifyPin(parsed.data.pin, staff?.pinHash ?? DUMMY_PIN_HASH);
  if (!org || !staff || !valid) return { ok: false, error: BAD_CREDENTIALS };

  const role: TicketingStaffRole = staff.role === 'ADMIN' || staff.role === 'MANAGER' ? staff.role : 'SCANNER';
  await createTicketStaffSession({
    staffId: staff.id, orgId: staff.orgId,
    capabilities: [...TICKETING_STAFF_CAPABILITIES[role]],
  });

  redirect(`/org/${staff.orgId}`);
}
