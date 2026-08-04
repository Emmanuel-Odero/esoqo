import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';

export interface UpsertProductInput {
  name: string;
  description?: string;
  priceKes: number;
  stockQty?: number | null;
}

export async function createProduct(ctx: Ctx, storeId: string, input: UpsertProductInput) {
  await assertOwnsStore(ctx, storeId, 'product.write');
  const product = await prisma.product.create({
    data: { storeId, name: input.name, description: input.description, priceKes: input.priceKes, stockQty: input.stockQty ?? null },
  });
  await recordAudit(ctx, { action: 'product.created', targetType: 'product', targetId: product.id, payload: { storeId, name: input.name } });
  return product;
}

export async function updateProduct(ctx: Ctx, productId: string, input: Partial<UpsertProductInput>) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  const updated = await prisma.product.update({ where: { id: productId }, data: input });
  await recordAudit(ctx, { action: 'product.updated', targetType: 'product', targetId: productId, payload: input });
  return updated;
}

export async function setProductVisibility(ctx: Ctx, productId: string, status: 'ACTIVE' | 'HIDDEN') {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  return prisma.product.update({ where: { id: productId }, data: { status } });
}

/** Public catalog read. No capability — a customer browsing a live store need not sign in. */
export async function listStoreProducts(_ctx: Ctx, storeId: string) {
  return prisma.product.findMany({ where: { storeId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
}

/** Merchant's own view — includes hidden/out-of-stock items. */
export async function listAllProductsForOwner(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'product.write');
  return prisma.product.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
}
