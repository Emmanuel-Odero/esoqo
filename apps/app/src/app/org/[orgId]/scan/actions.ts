'use server';
import { revalidatePath } from 'next/cache';
import { checkInTicketSchema } from '@esoko/domain';
import { requireOrgAccess } from '@/lib/session';
import { orgGo } from '@/lib/ticketing';

export async function actionCheckIn(orgId: string, raw: unknown) {
  const parsed = checkInTicketSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the code' };
  try {
    await requireOrgAccess(orgId);
    const res = await orgGo<{ ticketId: string }>(orgId, `/v1/ticketorgs/${orgId}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ code: parsed.data.code }),
    });
    revalidatePath(`/org/${orgId}/scan`);
    return { ok: true as const, data: { ticketId: res.ticketId } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't check that ticket in." };
  }
}
