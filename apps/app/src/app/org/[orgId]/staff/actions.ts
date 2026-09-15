'use server';
import { revalidatePath } from 'next/cache';
import { createTicketOrgStaffSchema } from '@esoqo/domain';
import { requireOrgAccess } from '@/lib/session';
import { orgGo } from '@/lib/ticketing';

const FALLBACK = "That didn't go through. Please try again.";

function goError(e: unknown): string {
  console.error(e);
  return e instanceof Error ? e.message : FALLBACK;
}

export async function actionCreateStaff(orgId: string, raw: unknown) {
  const parsed = createTicketOrgStaffSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    // Raw PIN goes to core-go; hashing happens at that boundary (never
    // stored or logged here) — the Go side of the old hashPin-at-the-
    // Server-Action contract.
    await orgGo(orgId, `/v1/ticketorgs/${orgId}/staff`, {
      method: 'POST',
      body: JSON.stringify({ name: parsed.data.name, pin: parsed.data.pin, role: parsed.data.role }),
    });
    revalidatePath(`/org/${orgId}/staff`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionSetStaffActive(orgId: string, staffId: string, active: boolean) {
  try {
    await requireOrgAccess(orgId);
    await orgGo(orgId, `/v1/org-staff/${staffId}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
    revalidatePath(`/org/${orgId}/staff`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}
