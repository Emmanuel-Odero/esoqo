'use server';
import { revalidatePath } from 'next/cache';
import { reviewDocument, updateDocument, deleteDocument } from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionReview(
  id: string, status: 'ACCEPTED' | 'REJECTED', note?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await reviewDocument(ctx, id, status, note);
    revalidatePath('/documents');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That review didn't save. Please try again.") };
  }
}

export async function actionUpdate(
  id: string, input: { title?: string; kind?: string },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateDocument(ctx, id, input);
    revalidatePath('/documents');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "Those changes didn't save. Please try again.") };
  }
}

export async function actionDelete(id: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await deleteDocument(ctx, id, reason);
    revalidatePath('/documents');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That document couldn't be deleted. Please try again.") };
  }
}
