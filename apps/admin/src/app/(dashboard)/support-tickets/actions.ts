'use server';
import { revalidatePath } from 'next/cache';
import { updateSupportTicketStatus, type SupportTicketStatus } from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionUpdateTicketStatus(
  id: string, status: SupportTicketStatus, staffNote?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateSupportTicketStatus(ctx, id, status, staffNote);
    revalidatePath('/support-tickets');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
