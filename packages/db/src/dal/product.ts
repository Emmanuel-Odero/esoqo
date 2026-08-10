import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { deleteObject } from '../storage';

export class ProductError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'HAS_SALES' | 'BAD_INPUT') {
    super(msg);
    this.name = 'ProductError';
  }
}

export interface UpsertProductInput {
  name: string;
  description?: string;
  category?: string;
  priceKes: number;
  /** Cost of goods — optional, feeds gross-profit reporting. */
  costKes?: number | null;
  /** Retail unit — "kg", "pc", "litre"… free text. */
  unit?: string | null;
  /** Unit the stock was bought in — see Product.purchaseUnit. */
  purchaseUnit?: string | null;
  stockQty?: number | null;
}

export async function createProduct(ctx: Ctx, storeId: string, input: UpsertProductInput) {
  await assertOwnsStore(ctx, storeId, 'product.write');
  const product = await prisma.product.create({
    data: {
      storeId, name: input.name, description: input.description, category: input.category,
      priceKes: input.priceKes, costKes: input.costKes ?? null, unit: input.unit ?? null,
      purchaseUnit: input.purchaseUnit ?? null, stockQty: input.stockQty ?? null,
    },
  });
  await recordAudit(ctx, { action: 'product.created', targetType: 'product', targetId: product.id, payload: { storeId, name: input.name } });
  return product;
}

export async function updateProduct(ctx: Ctx, productId: string, input: Partial<UpsertProductInput>) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  const updated = await prisma.product.update({ where: { id: productId }, data: input });
  await recordAudit(ctx, { action: 'product.updated', targetType: 'product', targetId: productId, payload: input });
  return updated;
}

export async function setProductVisibility(ctx: Ctx, productId: string, status: 'ACTIVE' | 'HIDDEN') {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  if (product.status === 'SUSPENDED') {
    throw new Error('Staff suspended this product — it needs to be reinstated before you can change it');
  }
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  return prisma.product.update({ where: { id: productId }, data: { status } });
}

/** A real delete — only possible for a product with no sales/order
 *  history, since StoreOrderItem/PosSaleItem/StockPurchase all reference
 *  it and Postgres won't let those rows point at nothing. A product
 *  that's ever sold gets hidden (setProductVisibility), not deleted —
 *  that history is the merchant's own record and nobody else's to erase. */
export async function deleteProduct(ctx: Ctx, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: true, _count: { select: { orderItems: true, posSaleItems: true, stockPurchases: true } } },
  });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');

  if (product._count.orderItems > 0 || product._count.posSaleItems > 0 || product._count.stockPurchases > 0) {
    throw new ProductError('This product has sales or purchase history — hide it instead of deleting it', 'HAS_SALES');
  }

  await prisma.product.delete({ where: { id: productId } });
  await Promise.all(product.images.map((img) => deleteObject(img.storageKey).catch(() => undefined)));

  await recordAudit(ctx, { action: 'product.deleted', targetType: 'product', targetId: productId, payload: { storeId: product.storeId } });
}

/** Public catalog read. No capability — a customer browsing a live store need not sign in. */
export async function listStoreProducts(_ctx: Ctx, storeId: string, category?: string) {
  return prisma.product.findMany({
    where: { storeId, status: 'ACTIVE', ...(category ? { category } : {}) },
    include: { images: { orderBy: { position: 'asc' } }, variants: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getStoreProduct(_ctx: Ctx, storeId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, storeId, status: 'ACTIVE' },
    include: { images: { orderBy: { position: 'asc' } }, variants: true },
  });
}

/** Merchant's own view — includes hidden/out-of-stock items. */
export async function listAllProductsForOwner(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'product.write');
  return prisma.product.findMany({
    where: { storeId },
    include: { images: { orderBy: { position: 'asc' } }, variants: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getProductForOwner(ctx: Ctx, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: { orderBy: { position: 'asc' } }, variants: true },
  });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  return product;
}

/* ── images ───────────────────────────────────────────────────── */

export interface AddProductImageInput {
  storageKey: string;
  /** Where to actually load the image from — `/img/{storageKey}`, the
   *  public image route in apps/store, on both the R2 and local-disk
   *  storage providers alike. Computed by the upload action. */
  url: string;
}

export async function addProductImage(ctx: Ctx, productId: string, input: AddProductImageInput) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { _count: { select: { images: true } } } });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');

  const image = await prisma.productImage.create({
    data: { productId, storageKey: input.storageKey, url: input.url, position: product._count.images },
  });
  await recordAudit(ctx, { action: 'product.image_added', targetType: 'product', targetId: productId });
  return image;
}

export async function deleteProductImage(ctx: Ctx, imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId }, include: { product: true } });
  if (!image) throw new ProductError('Image not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, image.product.storeId, 'product.write');

  await prisma.productImage.delete({ where: { id: imageId } });
  await deleteObject(image.storageKey).catch(() => undefined);
  await recordAudit(ctx, { action: 'product.image_removed', targetType: 'product', targetId: image.productId });
}

export async function reorderProductImages(ctx: Ctx, productId: string, orderedImageIds: string[]) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');

  await prisma.$transaction(
    orderedImageIds.map((id, position) => prisma.productImage.update({ where: { id, productId }, data: { position } })),
  );
}

/* ── variants ─────────────────────────────────────────────────── */

export interface UpsertVariantInput {
  label: string;
  priceKes: number;
  costKes?: number | null;
  stockQty?: number | null;
  sku?: string | null;
}

export async function createVariant(ctx: Ctx, productId: string, input: UpsertVariantInput) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductError('Product not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  if (!input.label.trim()) throw new ProductError('Give the variant a label — "500g", "Blue"…', 'BAD_INPUT');

  const variant = await prisma.productVariant.create({
    data: {
      productId, label: input.label.trim(), priceKes: input.priceKes,
      costKes: input.costKes ?? null, stockQty: input.stockQty ?? null, sku: input.sku?.trim() || null,
    },
  });
  await recordAudit(ctx, { action: 'product.variant_added', targetType: 'product', targetId: productId, payload: { label: variant.label } });
  return variant;
}

export async function updateVariant(ctx: Ctx, variantId: string, input: Partial<UpsertVariantInput>) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant) throw new ProductError('Variant not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, variant.product.storeId, 'product.write');

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.priceKes !== undefined ? { priceKes: input.priceKes } : {}),
      ...(input.costKes !== undefined ? { costKes: input.costKes } : {}),
      ...(input.stockQty !== undefined ? { stockQty: input.stockQty } : {}),
      ...(input.sku !== undefined ? { sku: input.sku?.trim() || null } : {}),
    },
  });
  await recordAudit(ctx, { action: 'product.variant_updated', targetType: 'product', targetId: variant.productId, payload: input });
  return updated;
}

export async function deleteVariant(ctx: Ctx, variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true, _count: { select: { posItems: true, orderItems: true, stockPurchases: true } } },
  });
  if (!variant) throw new ProductError('Variant not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, variant.product.storeId, 'product.write');

  if (variant._count.posItems > 0 || variant._count.orderItems > 0 || variant._count.stockPurchases > 0) {
    throw new ProductError('This variant has sales or purchase history — it can’t be removed', 'HAS_SALES');
  }
  await prisma.productVariant.delete({ where: { id: variantId } });
  await recordAudit(ctx, { action: 'product.variant_removed', targetType: 'product', targetId: variant.productId });
}

/* ── staff moderation ────────────────────────────────────────── */

export interface ProductDirectoryFilter {
  category?: string;
  status?: 'ACTIVE' | 'HIDDEN' | 'SUSPENDED';
  search?: string;
  take?: number;
  skip?: number;
}

/** Every product on the platform, for staff review by category —
 *  not scoped to one store, unlike everything above this line. */
export async function listProductsForStaff(ctx: Ctx, f: ProductDirectoryFilter = {}) {
  requireCapability(ctx, 'store.read');
  const where = {
    ...(f.category ? { category: f.category } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.search ? { name: { contains: f.search, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true, status: true } },
        _count: { select: { staffNotes: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

export async function getProductForStaff(ctx: Ctx, productId: string) {
  requireCapability(ctx, 'store.read');
  return prisma.product.findUnique({
    where: { id: productId },
    include: {
      store: {
        include: { enterprise: { include: { party: { include: { person: true, organisation: true } } } } },
      },
      staffNotes: { orderBy: { createdAt: 'desc' } },
    },
  });
}

/** Staff-only suspend — a merchant cannot lift this themselves; see
 *  setProductVisibility's guard above. Distinct from `product.write`
 *  on purpose: a role that can moderate any store's listing should not
 *  automatically be able to edit its price or description too. */
export async function suspendProduct(ctx: Ctx, productId: string, reason: string) {
  requireCapability(ctx, 'product.moderate');
  if (!reason.trim()) throw new Error('A reason is required to suspend a product');
  if (!ctx.actorId) throw new Error('Suspending a product requires a named staff account');

  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: 'SUSPENDED', reviewNote: reason, reviewedById: ctx.actorId, reviewedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'product.suspended', targetType: 'product', targetId: productId, payload: { reason },
  });
  return product;
}

export async function reinstateProduct(ctx: Ctx, productId: string) {
  requireCapability(ctx, 'product.moderate');
  if (!ctx.actorId) throw new Error('Reinstating a product requires a named staff account');

  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: 'ACTIVE', reviewNote: null, reviewedById: ctx.actorId, reviewedAt: new Date() },
  });
  await recordAudit(ctx, { action: 'product.reinstated', targetType: 'product', targetId: productId });
  return product;
}

/** A comment thread staff keep with a merchant about one listing —
 *  "the photo is unclear", "price looks like a typo" — visible to the
 *  merchant in their own product editor. Not a suspension by itself. */
export async function addProductStaffNote(ctx: Ctx, productId: string, note: string) {
  requireCapability(ctx, 'product.moderate');
  if (!note.trim()) throw new Error('Write something before sending');
  if (!ctx.actorId) throw new Error('Commenting on a product requires a named staff account');

  const created = await prisma.productStaffNote.create({
    data: { productId, staffId: ctx.actorId, note: note.trim() },
  });
  await recordAudit(ctx, {
    action: 'product.staff_note_added', targetType: 'product', targetId: productId, payload: { note },
  });
  return created;
}

/** The merchant's own view of staff comments on their product — read
 *  access via ordinary store ownership, not the staff capability. */
export async function listProductStaffNotesForOwner(ctx: Ctx, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  await assertOwnsStore(ctx, product.storeId, 'product.write');
  return prisma.productStaffNote.findMany({ where: { productId }, orderBy: { createdAt: 'desc' } });
}
