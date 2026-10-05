'use server';
import { revalidatePath } from 'next/cache';
import { approveHandleApplication, revokeHandleApplication } from '@esoqo/db';
import { toSafeErrorMessage } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionApproveHandleApplication(orgPartyId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await approveHandleApplication(ctx, orgPartyId);
    revalidatePath('/handle-applications');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionRevokeHandleApplication(orgPartyId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await revokeHandleApplication(ctx, orgPartyId, reason);
    revalidatePath('/handle-applications');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
