'use server';
import { revalidatePath } from 'next/cache';
import { createTicketOrgStaff, setTicketOrgStaffActive } from '@esoko/db';
import { createTicketOrgStaffSchema, toSafeErrorMessage } from '@esoko/domain';
import { hashPin } from '@esoko/auth';
import { requireOrgAccess } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again.";

export async function actionCreateStaff(orgId: string, raw: unknown) {
  const parsed = createTicketOrgStaffSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    const pinHash = await hashPin(parsed.data.pin);
    await createTicketOrgStaff(ctx, orgId, { name: parsed.data.name, pinHash, role: parsed.data.role });
    revalidatePath(`/org/${orgId}/staff`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSetStaffActive(orgId: string, staffId: string, active: boolean) {
  try {
    const { ctx } = await requireOrgAccess(orgId);
    await setTicketOrgStaffActive(ctx, staffId, active);
    revalidatePath(`/org/${orgId}/staff`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
