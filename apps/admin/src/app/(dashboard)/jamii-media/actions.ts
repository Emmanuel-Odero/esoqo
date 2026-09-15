'use server';
import { revalidatePath } from 'next/cache';
import { setMediaAssetActive, updateMediaAssetLabel } from '@esoqo/db';
import { toSafeErrorMessage } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionSetActive(id: string, active: boolean): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setMediaAssetActive(ctx, id, active);
    revalidatePath('/jamii-media');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionUpdateLabel(id: string, label: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateMediaAssetLabel(ctx, id, label);
    revalidatePath('/jamii-media');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
