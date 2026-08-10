import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import type { Prisma } from '@prisma/client';

/**
 * Suppliers and stock purchases.
 *
 * This is the other half of the profit picture a sale alone can't give.
 * Most MSMEs here don't sell at a fixed price — milk is KES 60 a litre
 * one day and KES 100 the next, tomatoes get haggled every single time
 * (see PosSaleItem.discountKes) — so "what did I sell it for" only
 * means something next to "what did it cost me". recordStockPurchase is
 * how a merchant tells the system what came in, from whom, at what
 * price, on what date: it bumps stock and folds the cost into a running
 * average, which is what Product.costKes then feeds into every gross
 * profit figure in dal/merchant-reports.ts.
 */

export class SupplierError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'WRONG_STORE' | 'BAD_INPUT') {
    super(msg);
    this.name = 'SupplierError';
  }
}

export interface UpsertSupplierInput {
  name: string;
  phone?: string | null;
  notes?: string | null;
}

export async function createSupplier(ctx: Ctx, storeId: string, input: UpsertSupplierInput) {
  await assertOwnsStore(ctx, storeId, 'inventory.write');
  if (!input.name.trim()) throw new SupplierError('Give the supplier a name', 'BAD_INPUT');

  const supplier = await prisma.supplier.create({
    data: { storeId, name: input.name.trim(), phone: input.phone?.trim() || null, notes: input.notes?.trim() || null },
  });
  await recordAudit(ctx, { action: 'supplier.created', targetType: 'supplier', targetId: supplier.id, payload: { storeId, name: supplier.name } });
  return supplier;
}

export async function updateSupplier(ctx: Ctx, supplierId: string, input: Partial<UpsertSupplierInput>) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new SupplierError('Supplier not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, supplier.storeId, 'inventory.write');

  const updated = await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    },
  });
  await recordAudit(ctx, { action: 'supplier.updated', targetType: 'supplier', targetId: supplierId, payload: input });
  return updated;
}

export async function listSuppliers(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'inventory.write');
  return prisma.supplier.findMany({
    where: { storeId },
    include: { _count: { select: { purchases: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function getSupplierWithPurchases(ctx: Ctx, supplierId: string, take = 50) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new SupplierError('Supplier not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, supplier.storeId, 'inventory.write');

  const purchases = await prisma.stockPurchase.findMany({
    where: { supplierId },
    include: { product: { select: { id: true, name: true } }, variant: { select: { id: true, label: true } } },
    orderBy: { purchasedAt: 'desc' },
    take,
  });
  return { supplier, purchases };
}

/** Weighted-average cost across what's already on hand and what's just
 *  come in. Stock that isn't counted (stockQty null) has no quantity
 *  basis to weight against, so there the newest purchase's price simply
 *  becomes the cost — the merchant is tracking cost but not units, and
 *  a moving average without units isn't an average, it's a guess. */
function nextCostKes(
  existingQty: number | null,
  existingCost: Prisma.Decimal | null,
  addQty: number,
  addUnitCost: number,
): number {
  const prevQty = existingQty ?? 0;
  const prevCost = existingCost ? Number(existingCost) : null;
  if (prevCost === null || prevQty <= 0) return addUnitCost;
  const weighted = (prevQty * prevCost + addQty * addUnitCost) / (prevQty + addQty);
  return Math.round(weighted * 100) / 100;
}

export interface RecordStockPurchaseInput {
  productId: string;
  variantId?: string | null;
  supplierId?: string | null;
  quantity: number;
  unitCostKes: number;
  /** ISO — when the stock actually arrived. Defaults to now. */
  purchasedAt?: string;
  notes?: string | null;
}

export async function recordStockPurchase(ctx: Ctx, storeId: string, input: RecordStockPurchaseInput) {
  await assertOwnsStore(ctx, storeId, 'inventory.write');
  if (input.quantity <= 0) throw new SupplierError('Quantity must be above zero', 'BAD_INPUT');
  if (input.unitCostKes < 0) throw new SupplierError('Cost cannot be negative', 'BAD_INPUT');

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || product.storeId !== storeId) throw new SupplierError('Product not found', 'WRONG_STORE');

  let variant: { id: string; productId: string; stockQty: number | null; costKes: Prisma.Decimal | null } | null = null;
  if (input.variantId) {
    variant = await prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true, productId: true, stockQty: true, costKes: true },
    });
    if (!variant || variant.productId !== input.productId) {
      throw new SupplierError('That variant does not belong to this product', 'WRONG_STORE');
    }
  }

  if (input.supplierId) {
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.storeId !== storeId) throw new SupplierError('Supplier not found', 'WRONG_STORE');
  }

  const totalCostKes = Math.round(input.quantity * input.unitCostKes * 100) / 100;

  const purchase = await prisma.$transaction(async (tx) => {
    const created = await tx.stockPurchase.create({
      data: {
        storeId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        supplierId: input.supplierId ?? null,
        quantity: input.quantity,
        unitCostKes: input.unitCostKes,
        totalCostKes,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : undefined,
        notes: input.notes?.trim() || null,
      },
    });

    if (variant) {
      await tx.productVariant.update({
        where: { id: variant.id },
        data: {
          costKes: nextCostKes(variant.stockQty, variant.costKes, input.quantity, input.unitCostKes),
          stockQty: variant.stockQty === null ? null : variant.stockQty + input.quantity,
        },
      });
    } else {
      await tx.product.update({
        where: { id: input.productId },
        data: {
          costKes: nextCostKes(product.stockQty, product.costKes, input.quantity, input.unitCostKes),
          stockQty: product.stockQty === null ? null : product.stockQty + input.quantity,
        },
      });
    }

    return created;
  });

  await recordAudit(ctx, {
    action: 'stock_purchase.recorded',
    targetType: 'stock_purchase',
    targetId: purchase.id,
    payload: { storeId, productId: input.productId, quantity: input.quantity, unitCostKes: input.unitCostKes, supplierId: input.supplierId ?? null },
  });

  return purchase;
}

export async function listStockPurchases(ctx: Ctx, storeId: string, take = 50) {
  await assertOwnsStore(ctx, storeId, 'inventory.write');
  return prisma.stockPurchase.findMany({
    where: { storeId },
    include: {
product: { select: { id: true, name: true, purchaseUnit: true } },
      variant: { select: { id: true, label: true } },
      supplier: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { purchasedAt: 'desc' },
    take,
  });
}
