'use server';

import { revalidatePath } from 'next/cache';
import {
  updatePricingRule, moderateStore, updateStore,
  suspendProduct, reinstateProduct, addProductStaffNote, getProductForStaff,
  flagOrderForReroute, clearRerouteFlag, findRerouteCandidates, reassignOrder,
} from '@esoko/db';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionUpdatePricing(key: string, amountKes: number | null, amountPct: number | null): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updatePricingRule(ctx, key, { amountKes, amountPct });
    revalidatePath('/estores/pricing');
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
    revalidatePath('/estores/stores');
    revalidatePath(`/estores/stores/${storeId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update that store' };
  }
}

export async function actionUpdateStoreDetails(
  storeId: string, patch: { name?: string; posEnabled?: boolean },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateStore(ctx, storeId, patch);
    revalidatePath(`/estores/stores/${storeId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That store's details didn't save" };
  }
}

/* ── products ─────────────────────────────────────────────────── */

export async function actionSuspendProduct(productId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await suspendProduct(ctx, productId, reason);
    revalidatePath('/estores/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not suspend that product' };
  }
}

export async function actionReinstateProduct(productId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await reinstateProduct(ctx, productId);
    revalidatePath('/estores/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reinstate that product' };
  }
}

export async function actionGetProductNotes(productId: string) {
  const ctx = await requireStaff();
  const product = await getProductForStaff(ctx, productId);
  return (product?.staffNotes ?? []).map((n) => ({ id: n.id, note: n.note, createdAt: n.createdAt.toISOString() }));
}

export async function actionAddProductNote(productId: string, note: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await addProductStaffNote(ctx, productId, note);
    revalidatePath('/estores/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That comment didn't send" };
  }
}

/* ── orders ───────────────────────────────────────────────────── */

export async function actionFlagOrderReroute(orderId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await flagOrderForReroute(ctx, orderId, reason);
    revalidatePath('/estores/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That order couldn't be flagged" };
  }
}

export async function actionClearRerouteFlag(orderId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await clearRerouteFlag(ctx, orderId);
    revalidatePath('/estores/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That flag couldn't be cleared" };
  }
}

export async function actionFindRerouteCandidates(orderId: string) {
  const ctx = await requireStaff();
  return findRerouteCandidates(ctx, orderId);
}

export async function actionReassignOrder(orderId: string, newStoreId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await reassignOrder(ctx, orderId, newStoreId);
    revalidatePath('/estores/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That order couldn't be reassigned" };
  }
}
