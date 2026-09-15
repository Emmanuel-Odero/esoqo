import { prisma } from '../client';
import { requireCapability, AuthorisationError, type Capability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { deleteObject } from '../storage';

/**
 * Stores.
 *
 * A store belongs to an Enterprise, which belongs to a Party — the
 * owner must already be a registered, credentialed subject before a
 * store can exist. There is no separate merchant-identity system for
 * the OWNER. There is a lighter one for whoever the owner puts behind
 * the till — see the AGENT branch in assertOwnsStore below, and
 * dal/cashier.ts.
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

/**
 * Loads a store and checks the caller may act on it as `capability`.
 * Two distinct callers land here:
 *   · a SUBJECT (the owner) — authorised by owning the enterprise's
 *     Party, via the `partyId` qualifier every SUBJECT capability
 *     carries (e.g. `pos.sell:own`).
 *   · an AGENT (a cashier or manager signed in at the till, see
 *     dal/cashier.ts) — authorised by ctx.storeId matching this store
 *     and holding the capability outright, no qualifier: a cashier
 *     session's whole capability list already IS the store-scoped
 *     grant, there's no separate Party to own anything.
 * Every DAL function that calls this transparently accepts both —
 * that's the point of routing both through one gate.
 */
export async function assertOwnsStore(ctx: Ctx, storeId: string, capability: Capability) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { enterprise: true },
  });
  if (!store) throw new StoreError('Store not found', 'NOT_FOUND');

  if (ctx.actorType === 'AGENT' && ctx.storeId) {
    // A session scoped to a different store must never fall through to
    // an unscoped capability check below — that check has no idea what
    // store it's being asked about, so it would happily authorise a
    // cashier from shop A to act on shop B.
    if (ctx.storeId !== storeId) throw new AuthorisationError(capability, ctx);
    requireCapability(ctx, capability);
    return store;
  }

  requireCapability(ctx, capability, { partyId: store.enterprise.partyId });
  return store;
}

export interface CreateStoreInput {
  enterpriseId: string;
  name: string;
  themeKey: string;
  routingMode: 'PATH' | 'SUBDOMAIN';
  posEnabled: boolean;
  /** Profile starts collected at creation — the rest happens later in
   *  Settings → Store profile. */
  tagline?: string;
  contactPhone?: string;
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
      tagline: input.tagline || null,
      contactPhone: input.contactPhone || null,
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

export interface StoreSettingsPatch extends Partial<Pick<CreateStoreInput, 'name' | 'themeKey' | 'posEnabled'>> {
  etimsEnabled?: boolean;
  loyaltyEnabled?: boolean;
  loyaltyPerKes?: number;
}

export async function updateStore(ctx: Ctx, storeId: string, patch: StoreSettingsPatch) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  const store = await prisma.store.update({ where: { id: storeId }, data: patch });
  await recordAudit(ctx, { action: 'store.updated', targetType: 'store', targetId: storeId, payload: { ...patch } });
  return store;
}

/** One step of the EStore profile — the caller passes exactly the fields
 *  its step schema validated. Only non-empty writes land so "clear a
 *  field" and "leave it alone" are distinguishable. */
export type StoreProfilePatch = Partial<{
  legalName: string; registrationNumber: string;
  contactPerson: string; contactEmail: string; contactPhone: string; physicalAddress: string;
  tagline: string; aboutUs: string;
  logoStorageKey: string; logoUrl: string;
  faviconStorageKey: string; faviconUrl: string;
  brandAccent: string;
  instagram: string; facebook: string; tiktok: string; whatsapp: string; linkedin: string;
  primaryCategory: string; skuCount: number | null;
  deliveryOrigin: string; deliveryZones: string[]; processingDays: number | null;
  currency: string; taxRatePct: number | null; settlementPhone: string;
  codEnabled: boolean;
}>;

export async function updateStoreProfile(ctx: Ctx, storeId: string, patch: StoreProfilePatch) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  const store = await prisma.store.update({ where: { id: storeId }, data: patch });
  await recordAudit(ctx, { action: 'store.profile_updated', targetType: 'store', targetId: storeId, payload: { ...patch } });
  return store;
}

/* ── storefront photos ────────────────────────────────────────── */

export async function addStorePhoto(ctx: Ctx, storeId: string, input: { storageKey: string; url: string }) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  const count = await prisma.storePhoto.count({ where: { storeId } });
  const photo = await prisma.storePhoto.create({
    data: { storeId, storageKey: input.storageKey, url: input.url, position: count },
  });
  await recordAudit(ctx, { action: 'store.photo_added', targetType: 'store', targetId: storeId });
  return photo;
}

export async function deleteStorePhoto(ctx: Ctx, photoId: string) {
  const photo = await prisma.storePhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new StoreError('That photo was not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, photo.storeId, 'store.write');
  await prisma.storePhoto.delete({ where: { id: photoId } });
  await deleteObject(photo.storageKey).catch(() => undefined);
  await recordAudit(ctx, { action: 'store.photo_removed', targetType: 'store', targetId: photo.storeId });
}

export async function reorderStorePhotos(ctx: Ctx, storeId: string, orderedPhotoIds: string[]) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  await prisma.$transaction(
    orderedPhotoIds.map((id, position) => prisma.storePhoto.update({ where: { id, storeId }, data: { position } })),
  );
}

export async function listStorePhotos(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'store.read');
  return prisma.storePhoto.findMany({ where: { storeId }, orderBy: { position: 'asc' } });
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
    include: {
      products: {
        where: { status: 'ACTIVE' },
        include: { images: { orderBy: { position: 'asc' } }, variants: true },
        orderBy: { createdAt: 'desc' },
      },
      fulfilmentOptions: { where: { active: true }, orderBy: { kind: 'asc' } },
      photos: { orderBy: { position: 'asc' } },
      // Owner trust facts shown on the storefront — the registered
      // business flag (Enterprise.isRegistered) drives the "Verified
      // Esoqo business" badge; county comes from the owner's Party.
      enterprise: { select: { isRegistered: true, party: { select: { county: true } } } },
    },
  });
}

/* ── delivery / pickup options ───────────────────────────────── */

export interface UpsertFulfilmentOptionInput {
  kind: 'PICKUP' | 'DELIVERY';
  label: string;
  feeKes: number;
}

export async function listFulfilmentOptions(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  return prisma.fulfilmentOption.findMany({ where: { storeId }, orderBy: { kind: 'asc' } });
}

export async function createFulfilmentOption(ctx: Ctx, storeId: string, input: UpsertFulfilmentOptionInput) {
  await assertOwnsStore(ctx, storeId, 'store.write');
  const option = await prisma.fulfilmentOption.create({
    data: { storeId, kind: input.kind, label: input.label.trim(), feeKes: input.feeKes },
  });
  await recordAudit(ctx, { action: 'fulfilment_option.created', targetType: 'store', targetId: storeId, payload: { ...input } });
  return option;
}

export async function setFulfilmentOptionActive(ctx: Ctx, optionId: string, active: boolean) {
  const option = await prisma.fulfilmentOption.findUnique({ where: { id: optionId } });
  if (!option) throw new StoreError('That delivery option was not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, option.storeId, 'store.write');
  return prisma.fulfilmentOption.update({ where: { id: optionId }, data: { active } });
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
      enterprise: { select: { workRaw: true, sector: true, isRegistered: true, party: { select: { county: true } } } },
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

/** Platform-wide counts, unaffected by whatever filter the directory
 *  page is currently showing — a KPI row has to mean "all stores",
 *  not "all stores matching what you happen to be looking at". */
export async function getStoreCounts(ctx: Ctx) {
  requireCapability(ctx, 'store.read');
  const [total, live, posEnabled] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { status: 'ACTIVE' } }),
    prisma.store.count({ where: { posEnabled: true } }),
  ]);
  return { total, live, posEnabled };
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

/**
 * One store's full picture for staff — the "help this owner
 * troubleshoot" view. Everything a support conversation needs in one
 * query: who owns it, what they're selling, how it's performing.
 */
export async function getStoreDetailForStaff(ctx: Ctx, storeId: string) {
  requireCapability(ctx, 'store.read');
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      enterprise: { include: { party: { include: { person: true, organisation: true } } } },
      products: { orderBy: { createdAt: 'desc' } },
      _count: { select: { products: true, orders: true, posSales: true } },
    },
  });
  if (!store) return null;

  const [orders, posSales, orderAgg, posAgg] = await Promise.all([
    prisma.storeOrder.findMany({
      where: { storeId }, orderBy: { createdAt: 'desc' }, take: 20,
      include: { items: { include: { product: true } } },
    }),
    prisma.posSale.findMany({
      where: { storeId }, orderBy: { soldAt: 'desc' }, take: 20,
      include: { items: { include: { product: true } } },
    }),
    // PAID and FULFILLED both mean "money changed hands" — fulfilment is
    // what happens after payment, not instead of it.
    prisma.storeOrder.aggregate({
      where: { storeId, status: { in: ['PAID', 'FULFILLED'] } }, _sum: { totalKes: true },
    }),
    prisma.posSale.aggregate({ where: { storeId }, _sum: { totalKes: true } }),
  ]);

  return {
    store,
    orders, posSales,
    revenueKes: Number(orderAgg._sum.totalKes ?? 0) + Number(posAgg._sum.totalKes ?? 0),
  };
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * The performance picture for one store — what a marketplace super-admin
 * actually looks at to judge health or help someone troubleshoot: a
 * revenue trend, where orders are getting stuck, how people are paying,
 * what's actually selling, and the two things that are silently costing
 * this merchant money if nobody looks — stock about to run out, and PoS
 * sales stuck unreconciled.
 */
export async function getStoreAnalyticsForStaff(ctx: Ctx, storeId: string, days = 30) {
  requireCapability(ctx, 'store.read');

  // "days" full buckets ending TODAY, not yesterday — days-1 back, not
  // days back, or the day-bucket loop below silently drops anything
  // that happened today from the trend (and everything summed from it).
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [orders, posSales, products, conflictSales] = await Promise.all([
    prisma.storeOrder.findMany({
      where: { storeId, createdAt: { gte: since } },
      select: {
        status: true, paymentMethod: true, totalKes: true, buyerMsisdn: true,
        createdAt: true, paidAt: true,
        items: { select: { quantity: true, unitPriceKes: true, product: { select: { id: true, name: true } } } },
      },
    }),
    prisma.posSale.findMany({
      where: { storeId, soldAt: { gte: since } },
      select: {
        paymentMethod: true, totalKes: true, soldAt: true, syncStatus: true,
        items: { select: { quantity: true, unitPriceKes: true, product: { select: { id: true, name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { storeId, status: 'ACTIVE', stockQty: { not: null, lte: 5 } },
      select: { id: true, name: true, stockQty: true },
      orderBy: { stockQty: 'asc' },
    }),
    prisma.posSale.findMany({
      where: { storeId, syncStatus: 'CONFLICT' },
      select: { id: true, clientSaleId: true, totalKes: true, soldAt: true },
      orderBy: { soldAt: 'desc' },
      take: 10,
    }),
  ]);

  const paidOrders = orders.filter((o) => o.status === 'PAID' || o.status === 'FULFILLED');

  // Revenue trend — a day bucket for every day in the window, even ones
  // with nothing in them, so the chart's x-axis is continuous.
  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(dayKey(d), 0);
  }
  for (const o of paidOrders) {
    const key = dayKey(o.paidAt ?? o.createdAt);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + Number(o.totalKes));
  }
  for (const s of posSales) {
    const key = dayKey(s.soldAt);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + Number(s.totalKes));
  }
  const dailyRevenue = [...byDay.entries()].map(([date, revenueKes]) => ({ date, revenueKes }));

  // Week-over-week — the last 7 complete days against the 7 before that.
  const last7 = dailyRevenue.slice(-7).reduce((n, d) => n + d.revenueKes, 0);
  const prior7 = dailyRevenue.slice(-14, -7).reduce((n, d) => n + d.revenueKes, 0);
  const wowChangePct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;

  // Order status — the funnel a support call needs: how many are stuck
  // before payment, how many paid but never got marked fulfilled.
  const statusBreakdown = (['PENDING_PAYMENT', 'PAID', 'FULFILLED', 'CANCELLED'] as const).map((status) => ({
    status, count: orders.filter((o) => o.status === status).length,
  }));

  const fulfillable = orders.filter((o) => o.status === 'PAID' || o.status === 'FULFILLED').length;
  const fulfilled = orders.filter((o) => o.status === 'FULFILLED').length;
  const fulfillmentRatePct = fulfillable > 0 ? Math.round((fulfilled / fulfillable) * 100) : null;

  // Payment split — online and till are different rails with different
  // failure modes, worth seeing separately, not folded into one count.
  const paymentSplit = [
    { label: 'M-Pesa (online)', count: orders.filter((o) => o.paymentMethod === 'MPESA_STK').length },
    { label: 'Cash on delivery', count: orders.filter((o) => o.paymentMethod === 'CASH_ON_DELIVERY').length },
    { label: 'Cash (till)', count: posSales.filter((s) => s.paymentMethod === 'CASH').length },
    { label: 'M-Pesa (till)', count: posSales.filter((s) => s.paymentMethod === 'MPESA_TILL').length },
  ].filter((p) => p.count > 0);

  // Top products — online and PoS sales of the same item are the same
  // product performing, not two separate signals.
  const productAgg = new Map<string, { name: string; unitsSold: number; revenueKes: number }>();
  for (const src of [...orders.flatMap((o) => o.items), ...posSales.flatMap((s) => s.items)]) {
    const cur = productAgg.get(src.product.id) ?? { name: src.product.name, unitsSold: 0, revenueKes: 0 };
    cur.unitsSold += src.quantity;
    cur.revenueKes += src.quantity * Number(src.unitPriceKes);
    productAgg.set(src.product.id, cur);
  }
  const topProducts = [...productAgg.values()].sort((a, b) => b.revenueKes - a.revenueKes).slice(0, 5);

  // Buyers — repeat custom is the strongest health signal a young store
  // has, well before "total revenue" means anything on its own.
  const buyerCounts = new Map<string, number>();
  for (const o of orders) buyerCounts.set(o.buyerMsisdn, (buyerCounts.get(o.buyerMsisdn) ?? 0) + 1);
  const uniqueBuyers = buyerCounts.size;
  const repeatBuyers = [...buyerCounts.values()].filter((n) => n > 1).length;

  return {
    dailyRevenue, wowChangePct,
    statusBreakdown, fulfillmentRatePct,
    paymentSplit, topProducts,
    uniqueBuyers, repeatBuyers,
    lowStock: products,
    posConflicts: conflictSales,
    windowDays: days,
  };
}

/**
 * Every enterprise actually selling on the platform — the "users /
 * traders" list. An Enterprise only shows up here once it has opened
 * at least one Store; having a business on file isn't the same as
 * having gone live.
 */
export interface TraderFilter { search?: string; take?: number; skip?: number }

export async function listStoreOwnersForStaff(ctx: Ctx, f: TraderFilter = {}) {
  requireCapability(ctx, 'store.read');
  const where = {
    stores: { some: {} },
    ...(f.search
      ? {
          OR: [
            { workRaw: { contains: f.search, mode: 'insensitive' as const } },
            { party: { person: { officialName: { contains: f.search, mode: 'insensitive' as const } } } },
            { party: { person: { knownAs: { contains: f.search, mode: 'insensitive' as const } } } },
            { party: { organisation: { officialName: { contains: f.search, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.enterprise.findMany({
      where,
      include: {
        party: { include: { person: true, organisation: true } },
        stores: { select: { id: true, name: true, slug: true, status: true, posEnabled: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.enterprise.count({ where }),
  ]);
  return { rows, total };
}

/**
 * The marketplace-wide picture — what a super-admin lands on first,
 * before drilling into any one store: how much is actually moving
 * through the platform, what the platform is earning from it, which
 * stores are driving that, and the shape of the seller base itself.
 */
export async function getEstoreOverview(ctx: Ctx, days = 30) {
  requireCapability(ctx, 'store.read');

  // "days" full buckets ending TODAY, not yesterday — days-1 back, not
  // days back, or the day-bucket loop below silently drops anything
  // that happened today from the trend (and everything summed from it).
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [stores, orders, posSales, feeRule] = await Promise.all([
    prisma.store.findMany({
      select: {
        id: true, name: true, slug: true, status: true, posEnabled: true, createdAt: true,
        enterprise: { select: { sector: true, party: { include: { person: true, organisation: true } } } },
      },
    }),
    prisma.storeOrder.findMany({
      where: { createdAt: { gte: since } },
      select: { storeId: true, status: true, totalKes: true, createdAt: true, paidAt: true },
    }),
    prisma.posSale.findMany({
      where: { soldAt: { gte: since } },
      select: { storeId: true, totalKes: true, soldAt: true },
    }),
    prisma.pricingRule.findUnique({ where: { key: 'PLATFORM_FEE_PCT' } }),
  ]);

  const paidOrders = orders.filter((o) => o.status === 'PAID' || o.status === 'FULFILLED');
  const platformFeePct = feeRule?.amountPct ? Number(feeRule.amountPct) : 0;

  // Revenue trend — platform-wide, same day-bucketing shape as a single
  // store's chart so the UI component is shared unchanged.
  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of paidOrders) {
    const key = (o.paidAt ?? o.createdAt).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + Number(o.totalKes));
  }
  for (const s of posSales) {
    const key = s.soldAt.toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + Number(s.totalKes));
  }
  const dailyRevenue = [...byDay.entries()].map(([date, revenueKes]) => ({ date, revenueKes }));
  const gmvKes = dailyRevenue.reduce((n, d) => n + d.revenueKes, 0);
  const commissionEarnedKes = Math.round(gmvKes * (platformFeePct / 100));

  const last7 = dailyRevenue.slice(-7).reduce((n, d) => n + d.revenueKes, 0);
  const prior7 = dailyRevenue.slice(-14, -7).reduce((n, d) => n + d.revenueKes, 0);
  const wowChangePct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;

  // Per-store revenue — the leaderboard. Online and PoS sales of the
  // same store are the same store performing, folded into one number.
  const revenueByStore = new Map<string, number>();
  for (const o of paidOrders) revenueByStore.set(o.storeId, (revenueByStore.get(o.storeId) ?? 0) + Number(o.totalKes));
  for (const s of posSales) revenueByStore.set(s.storeId, (revenueByStore.get(s.storeId) ?? 0) + Number(s.totalKes));

  const topStores = [...revenueByStore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([storeId, revenueKes]) => {
      const store = stores.find((s) => s.id === storeId)!;
      const owner = store.enterprise.party.person?.knownAs || store.enterprise.party.person?.officialName
        || store.enterprise.party.organisation?.knownAs || store.enterprise.party.organisation?.officialName || '—';
      return { id: store.id, name: store.name, status: store.status, owner, revenueKes };
    });

  const statusBreakdown = (['ACTIVE', 'DRAFT', 'SUSPENDED'] as const).map((status) => ({
    status, count: stores.filter((s) => s.status === status).length,
  }));

  const sectorCounts = new Map<string, number>();
  for (const s of stores) {
    const key = s.enterprise.sector?.trim() || 'Unclassified';
    sectorCounts.set(key, (sectorCounts.get(key) ?? 0) + 1);
  }
  const sectorBreakdown = [...sectorCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([sector, count]) => ({ sector, count }));

  const ordersThisWindow = orders.length;
  const newStores = stores.filter((s) => s.createdAt >= since).length;
  const posEnabledCount = stores.filter((s) => s.posEnabled).length;

  return {
    windowDays: days,
    gmvKes, commissionEarnedKes, platformFeePct, wowChangePct,
    dailyRevenue,
    totalStores: stores.length, statusBreakdown, newStores,
    posEnabledCount, posAdoptionPct: stores.length > 0 ? Math.round((posEnabledCount / stores.length) * 100) : 0,
    ordersThisWindow, topStores, sectorBreakdown,
  };
}
