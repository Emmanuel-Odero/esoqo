'use server';

import { revalidatePath } from 'next/cache';
import {
  updateProduct, deleteProduct, ProductError,
  addProductImage, deleteProductImage, reorderProductImages,
  createVariant, updateVariant, deleteVariant,
  sniff, makeStorageKey, putObject, MAX_BYTES,
} from '@esoqo/db';
import { updateProductSchema, variantSchema } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveProduct(productId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await updateProduct(ctx, productId, {
      ...parsed.data,
      description: parsed.data.description || undefined,
      unit: parsed.data.unit || null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save this product' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath('/dashboard/products');
  return { ok: true };
}

export async function removeProduct(productId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteProduct(ctx, productId);
  } catch (e) {
    if (e instanceof ProductError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete this product' };
  }
  revalidatePath('/dashboard/products');
  return { ok: true };
}

export async function uploadProductImage(productId: string, form: FormData): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'No file was attached' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'That file is larger than 1 MB' };

    const buf = Buffer.from(await file.arrayBuffer());
    const check = sniff(buf, file.type, file.name);
    if (!check.ok || !check.mime || !check.mime.startsWith('image/')) {
      return { ok: false, error: check.reason ?? 'Only PNG or JPEG photos are accepted' };
    }

    const storageKey = makeStorageKey(check.mime);
    await putObject(storageKey, buf);
    await addProductImage(ctx, productId, { storageKey, url: `/img/${storageKey}` });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That photo didn't upload — try again" };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}

export async function removeProductImage(imageId: string, productId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteProductImage(ctx, imageId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove this photo' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}

export async function reorderImages(productId: string, orderedIds: string[]): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await reorderProductImages(ctx, productId, orderedIds);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reorder photos' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}

export async function addVariant(productId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = variantSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await createVariant(ctx, productId, { ...parsed.data, sku: parsed.data.sku || null });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this option' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}

export async function editVariant(variantId: string, productId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = variantSchema.partial().safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await updateVariant(ctx, variantId, parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save this option' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}

export async function removeVariant(variantId: string, productId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteVariant(ctx, variantId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove this option' };
  }
  revalidatePath(`/dashboard/products/${productId}`);
  return { ok: true };
}
