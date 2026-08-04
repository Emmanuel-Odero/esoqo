'use server';

import { revalidatePath } from 'next/cache';
import { createProduct, setProductVisibility } from '@esoko/db';
import { createProductSchema } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addProduct(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = createProductSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await createProduct(ctx, storeId, parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this product' };
  }
  revalidatePath('/dashboard/products');
  return { ok: true };
}

export async function toggleProductVisibility(productId: string, status: 'ACTIVE' | 'HIDDEN') {
  const ctx = await requireSubject();
  await setProductVisibility(ctx, productId, status);
  revalidatePath('/dashboard/products');
}
