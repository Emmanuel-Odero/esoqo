'use server';
import { revalidatePath } from 'next/cache';
import { createFeeBand, deleteFeeBand, type TransactionFeeKind } from '@esoqo/db';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionCreateFeeBand(
  kind: TransactionFeeKind, minKes: number, maxKes: number, feeKes: number,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await createFeeBand(ctx, { kind, minKes, maxKes, feeKes });
    revalidatePath('/payments/fees');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that band' };
  }
}

export async function actionDeleteFeeBand(id: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await deleteFeeBand(ctx, id);
    revalidatePath('/payments/fees');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that band' };
  }
}
