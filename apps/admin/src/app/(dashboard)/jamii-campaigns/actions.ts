'use server';
import { revalidatePath } from 'next/cache';
import { moderateCampaign } from '@esoqo/db';
import { toSafeErrorMessage } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionModerateCampaign(
  campaignId: string, status: 'ACTIVE' | 'CANCELLED', reason: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await moderateCampaign(ctx, campaignId, status, reason);
    revalidatePath('/jamii-campaigns');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
