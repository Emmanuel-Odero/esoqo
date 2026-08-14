'use server';
import { revalidatePath } from 'next/cache';
import { checkInTicket } from '@esoko/db';
import { checkInTicketSchema, toSafeErrorMessage } from '@esoko/domain';
import { requireOrgAccess } from '@/lib/session';

export async function actionCheckIn(orgId: string, raw: unknown) {
  const parsed = checkInTicketSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the code' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    const ticket = await checkInTicket(ctx, orgId, parsed.data.code);
    revalidatePath(`/org/${orgId}/scan`);
    return { ok: true as const, data: { ticketId: ticket.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, "Couldn't check that ticket in.") };
  }
}
