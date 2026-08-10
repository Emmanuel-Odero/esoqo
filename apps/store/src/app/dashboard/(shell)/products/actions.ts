'use server';

import { revalidatePath } from 'next/cache';
import { createProduct, createVariant, setProductVisibility, recordStockPurchase } from '@esoko/db';
import { createProductWithVariantsSchema } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true; productId: string } | { ok: false; error: string };

export async function addProduct(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = createProductWithVariantsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  const { variants, costKes, stockQty, ...productInput } = parsed.data;

  let productId: string;
  try {
    // When both a quantity and a cost are known, this IS the first
    // delivery — record it as a real StockPurchase (same path Stock &
    // suppliers uses) rather than just stamping costKes/stockQty on the
    // product directly. That's what makes it show up in the delivery
    // history and keeps one place responsible for the stock+cost math
    // (see recordStockPurchase's moving average) instead of two.
    const hasInitialBatch = stockQty != null && stockQty > 0 && costKes != null;
    const product = await createProduct(ctx, storeId, {
      ...productInput,
      // No initial batch to record → fall back to stamping stock/cost
      // directly, so "I have 20, no cost tracking" still works.
      stockQty: hasInitialBatch ? null : stockQty,
      costKes: hasInitialBatch ? null : costKes,
    });
    productId = product.id;
    if (hasInitialBatch) {
      await recordStockPurchase(ctx, storeId, {
        productId, quantity: stockQty!, unitCostKes: costKes!,
        notes: 'Recorded when the product was added',
      });
    }

    // Portions the merchant already subdivided this into — 20 litres cut
    // into 400ml/500ml sachets, each its own sellable line from the start.
    for (const v of variants ?? []) {
      const variant = await createVariant(ctx, productId, { label: v.label, priceKes: v.priceKes });
      if (v.stockQty != null && v.stockQty > 0 && v.costKes != null) {
        await recordStockPurchase(ctx, storeId, {
          productId, variantId: variant.id, quantity: v.stockQty, unitCostKes: v.costKes,
          notes: 'Portioned from the batch recorded when the product was added',
        });
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this product' };
  }
  revalidatePath('/dashboard/products');
  revalidatePath('/dashboard/stock');
  return { ok: true, productId };
}

export async function toggleProductVisibility(productId: string, status: 'ACTIVE' | 'HIDDEN') {
  const ctx = await requireSubject();
  await setProductVisibility(ctx, productId, status);
  revalidatePath('/dashboard/products');
}
