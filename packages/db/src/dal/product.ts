import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';

export interface UpsertProductInput {
  name: string;
  description?: string;
  category?: string;
  priceKes: number;
  stockQty?: number | null;
}

export async function createProduct(ctx: Ctx, storeId: string, input: UpsertProductInput) {
  await assertOwnsStore(ctx, storeId, 'product.write');
  const product = await prisma.product.create({
    data: {
      storeId, name: input.name, description: input.description, category: input.category,
      priceKes: input.priceKes, stockQty: input.stockQty ?? null,
    },
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
  if (product.status === 'SUSPENDED') {
    throw new Error('Staff suspended this product — it needs to be reinstated before you can change it');
  }
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
