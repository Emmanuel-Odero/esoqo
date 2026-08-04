import { prisma } from '../client';
import { requireCapability, type Capability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Stores.
 *
 * A store belongs to an Enterprise, which belongs to a Party — the
 * owner must already be a registered, credentialed subject before a
 * store can exist. There is no separate merchant-identity system.
 */

export class StoreError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'SLUG_TAKEN' | 'NOT_YOUR_ENTERPRISE') {
    super(msg);
    this.name = 'StoreError';
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

/** Loads a store and checks the caller holds `capability` scoped to its owning party. */
export async function assertOwnsStore(ctx: Ctx, storeId: string, capability: Capability) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { enterprise: true },
  });
  if (!store) throw new StoreError('Store not found', 'NOT_FOUND');
  requireCapability(ctx, capability, { partyId: store.enterprise.partyId });
  return store;
}

export interface CreateStoreInput {
  enterpriseId: string;
  name: string;
  themeKey: string;
  routingMode: 'PATH' | 'SUBDOMAIN';
  posEnabled: boolean;
}

export async function createStore(ctx: Ctx, input: CreateStoreInput) {
  if (!ctx.partyId) throw new Error('Sign in to open a store');

  const enterprise = await prisma.enterprise.findUnique({ where: { id: input.enterpriseId } });
  if (!enterprise || enterprise.partyId !== ctx.partyId) {
    throw new StoreError('That business is not on your account', 'NOT_YOUR_ENTERPRISE');
  }
  requireCapability(ctx, 'store.write', { partyId: ctx.partyId });

  const base = slugify(input.name);
  let slug = base;
  for (let n = 1; await prisma.store.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`;
  }

  const store = await prisma.store.create({
    data: {
      enterpriseId: input.enterpriseId,
      name: input.name,
      slug,
      themeKey: input.themeKey,
      routingMode: input.routingMode,
      posEnabled: input.posEnabled,
      status: 'ACTIVE',
    },
  });

  await recordAudit(ctx, {
    action: 'store.created',
    targetType: 'store',
    targetId: store.id,
    payload: { slug, routingMode: input.routingMode, posEnabled: input.posEnabled },
  });

  return store;
}

export async function updateStore(
  ctx: Ctx,
  storeId: string,
  patch: Partial<Pick<CreateStoreInput, 'name' | 'themeKey' | 'posEnabled'>>,
) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  const store = await prisma.store.update({ where: { id: storeId }, data: patch });
  await recordAudit(ctx, { action: 'store.updated', targetType: 'store', targetId: storeId, payload: patch });
  return store;
}

/** The stores a signed-in subject owns, across every Enterprise on their Party. */
export async function listMyStores(ctx: Ctx) {
  if (!ctx.partyId) return [];
  requireCapability(ctx, 'store.read', { partyId: ctx.partyId });
  return prisma.store.findMany({
    where: { enterprise: { partyId: ctx.partyId } },
    include: { _count: { select: { products: true, orders: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getStoreForOwner(ctx: Ctx, storeId: string) {
  return assertOwnsStore(ctx, storeId, 'store.read');
}

/** Public storefront lookup. No capability — anyone may browse a live store. */
export async function getStoreBySlug(_ctx: Ctx, slug: string) {
  return prisma.store.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: { products: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } } },
  });
}

export interface PublicStoreFilter {
  county?: string;
  search?: string;
  take?: number;
}

/**
 * The public directory — apps/web's /discover page. No capability:
 * this is the same "anyone may browse a live store" grant as
 * getStoreBySlug, just listing many instead of resolving one.
 */
export async function listPublicStores(_ctx: Ctx, f: PublicStoreFilter = {}) {
  return prisma.store.findMany({
    where: {
      status: 'ACTIVE',
      ...(f.county ? { enterprise: { party: { county: f.county } } } : {}),
      ...(f.search ? { name: { contains: f.search, mode: 'insensitive' as const } } : {}),
    },
    include: {
      enterprise: { select: { workRaw: true, sector: true, party: { select: { county: true } } } },
      _count: { select: { products: { where: { status: 'ACTIVE' } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: f.take ?? 60,
  });
}

/* ── staff oversight ─────────────────────────────────────────── */

export interface StoreDirectoryFilter {
  status?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  search?: string;
  take?: number;
  skip?: number;
}

export async function listStoresForStaff(ctx: Ctx, f: StoreDirectoryFilter = {}) {
  requireCapability(ctx, 'store.read');
  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.search ? { name: { contains: f.search, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.store.findMany({
      where,
      include: {
        enterprise: { include: { party: { include: { person: true, organisation: true } } } },
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 25,
      skip: f.skip ?? 0,
    }),
    prisma.store.count({ where }),
  ]);
  return { rows, total };
}

export async function moderateStore(ctx: Ctx, storeId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
  requireCapability(ctx, 'store.moderate');
  const store = await prisma.store.update({ where: { id: storeId }, data: { status } });
  await recordAudit(ctx, {
    action: status === 'SUSPENDED' ? 'store.suspended' : 'store.reinstated',
    targetType: 'store',
    targetId: storeId,
    payload: { reason },
  });
  return store;
}
