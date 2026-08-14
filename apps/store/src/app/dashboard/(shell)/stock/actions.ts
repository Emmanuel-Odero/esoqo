'use server';

import { revalidatePath } from 'next/cache';
import { createSupplier, recordStockPurchase } from '@esoko/db';
import { supplierSchema, stockPurchaseSchema } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addSupplier(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = supplierSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await createSupplier(ctx, storeId, { ...parsed.data, phone: parsed.data.phone || null, notes: parsed.data.notes || null });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this supplier' };
  }
  revalidatePath('/dashboard/stock');
  return { ok: true };
}

export async function addStockPurchase(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = stockPurchaseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await recordStockPurchase(ctx, storeId, { ...parsed.data, notes: parsed.data.notes || null });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not record this purchase' };
  }
  revalidatePath('/dashboard/stock');
  revalidatePath('/dashboard/products');
  return { ok: true };
}
