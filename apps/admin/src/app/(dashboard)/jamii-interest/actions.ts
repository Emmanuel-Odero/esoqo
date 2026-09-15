'use server';
import { revalidatePath } from 'next/cache';
import { reviewJamiiInterest, approveJamiiInterest, type JamiiInterestStatus } from '@esoqo/db';
import { toSafeErrorMessage } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionReviewInterest(
  id: string, status: Exclude<JamiiInterestStatus, 'CONVERTED'>, note?: string,
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

/** Approves an application and grants Our Jamii access — for a brand-new
 *  applicant this also creates their Person record, see
 *  @esoqo/db's approveJamiiInterest. */
export async function actionApproveInterest(id: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await approveJamiiInterest(ctx, id);
    revalidatePath('/jamii-interest');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't approve. Please try again.") };
  }
}
