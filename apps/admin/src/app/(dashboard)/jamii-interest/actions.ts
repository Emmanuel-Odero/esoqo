'use server';
import { revalidatePath } from 'next/cache';
import { reviewJamiiInterest, type JamiiInterestStatus } from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionReviewInterest(
  id: string, status: JamiiInterestStatus, note?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await reviewJamiiInterest(ctx, id, { status, reviewNote: note });
    revalidatePath('/jamii-interest');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
