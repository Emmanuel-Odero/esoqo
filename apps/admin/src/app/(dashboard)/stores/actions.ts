'use server';

import { revalidatePath } from 'next/cache';
import { updatePricingRule, moderateStore } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionUpdatePricing(key: string, amountKes: number | null, amountPct: number | null): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updatePricingRule(ctx, key, { amountKes, amountPct });
    revalidatePath('/stores');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that price' };
  }
}

export async function actionModerateStore(storeId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (status === 'SUSPENDED' && !reason.trim()) return { ok: false, error: 'A reason is required to suspend a store' };
    await moderateStore(ctx, storeId, status, reason);
    revalidatePath('/stores');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update that store' };
  }
}
