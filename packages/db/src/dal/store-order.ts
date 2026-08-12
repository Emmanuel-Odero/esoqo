import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { postStoreSale } from './_commerce-ledger';
import { findOrCreateCustomer, earnLoyaltyForSale } from './customer';
import type { StoreOrderPaymentMethod, StoreOrderStatus } from '@prisma/client';

export class StoreOrderError extends Error {
  constructor(
    msg: string,
    public readonly code: 'STORE_UNAVAILABLE' | 'ITEM_UNAVAILABLE' | 'PAYMENT_UNAVAILABLE' | 'NOT_FOUND',
  ) {
    super(msg);
    this.name = 'StoreOrderError';
  }
}

export interface CreateOrderInput {
  storeSlug: string;
  buyerName: string;
  buyerMsisdn: string;
  paymentMethod: StoreOrderPaymentMethod;
  items: { productId: string; variantId?: string | null; quantity: number }[];
  deliveryOptionId?: string | null;
  collectionNotes?: string;
  deliveryAddress?: string;
}

/**
 * Public checkout. No capability required — a buyer need not be a
 * registered Esoko subject; ctx.partyId is attached when they are.
 */
export async function createStoreOrder(ctx: Ctx, input: CreateOrderInput) {
  const store = await prisma.store.findFirst({ where: { slug: input.storeSlug, status: 'ACTIVE' } });
  if (!store) throw new StoreOrderError('This store is not available', 'STORE_UNAVAILABLE');

  // Cash on delivery is opt-in per store — the seller chose whether their
  // storefront offers it (Store.codEnabled). Never silently accept a COD
  // the merchant hasn't switched on.
  if (input.paymentMethod === 'CASH_ON_DELIVERY' && !store.codEnabled) {
    throw new StoreOrderError('This shop does not offer cash on delivery', 'PAYMENT_UNAVAILABLE');
  }

  const [products, variants] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) }, storeId: store.id, status: 'ACTIVE' },
    }),
    prisma.productVariant.findMany({
      where: { id: { in: input.items.map((i) => i.variantId).filter((v): v is string => Boolean(v)) } },
    }),
  ]);
  if (products.length !== input.items.length) {
    throw new StoreOrderError('One of these items is no longer available', 'ITEM_UNAVAILABLE');
  }

  let deliveryFeeKes = 0;
  if (input.deliveryOptionId) {
    const option = await prisma.fulfilmentOption.findUnique({ where: { id: input.deliveryOptionId } });
    if (!option || option.storeId !== store.id || !option.active) {
      throw new StoreOrderError('That delivery option is no longer available', 'ITEM_UNAVAILABLE');
    }
    deliveryFeeKes = Number(option.feeKes);
  }

  const items = input.items.map((i) => {
    const p = products.find((pr) => pr.id === i.productId)!;
    const v = i.variantId ? variants.find((vr) => vr.id === i.variantId && vr.productId === p.id) : undefined;
    if (i.variantId && !v) throw new StoreOrderError('One of these items is no longer available', 'ITEM_UNAVAILABLE');
    // Order-first stock rule: a tracked item at zero (or below) sells
    // only when the merchant marked it availableOnOrder — the badge the
    // storefront shows as "Fulfilled when ordered". Untracked stock
    // (null) stays sellable as before. No reservation/decrement here;
    // that's the seller's stock-keeping decision.
    const eff = v ? v : p;
    if (eff.stockQty !== null && eff.stockQty <= 0 && !eff.availableOnOrder) {
      throw new StoreOrderError(`${p.name} is sold out`, 'ITEM_UNAVAILABLE');
    }
    // Cost snapshot at order time, same reasoning as PosSaleItem.costKes —
    // a later price/cost edit must never rewrite what this sale actually
    // cost, or gross profit reporting drifts every time a merchant
    // updates a listing.
    return {
      productId: p.id, variantId: v?.id ?? null, quantity: i.quantity,
      unitPriceKes: v?.priceKes ?? p.priceKes, costKes: v?.costKes ?? p.costKes,
    };
  });
  const totalKes = items.reduce((sum, i) => sum + Number(i.unitPriceKes) * i.quantity, 0) + deliveryFeeKes;

  // Auto-capture — same "a phone number is all it takes" rule the PoS
  // terminal follows, so a shopper's order and loyalty history line up
  // whether they bought online or walked into the shop.
  const customer = await findOrCreateCustomer(store.id, input.buyerMsisdn, input.buyerName);

  const order = await prisma.storeOrder.create({
    data: {
      storeId: store.id,
      buyerPartyId: ctx.partyId ?? null,
      buyerName: input.buyerName,
      buyerMsisdn: input.buyerMsisdn,
      paymentMethod: input.paymentMethod,
      totalKes,
      deliveryOptionId: input.deliveryOptionId ?? null,
      deliveryFeeKes: input.deliveryOptionId ? deliveryFeeKes : null,
      collectionNotes: input.collectionNotes?.trim() || null,
      deliveryAddress: input.deliveryAddress?.trim() || null,
      customerId: customer.id,
      items: { create: items },
    },
    include: { items: { include: { product: true } } },
  });

  await recordAudit(ctx, {
    action: 'store_order.created',
    targetType: 'store_order',
    targetId: order.id,
    payload: { storeId: store.id, totalKes },
  });

  return order;
}

/** Stamps the Daraja CheckoutRequestID onto an order right after STK push is initiated. */
export async function attachCheckoutRequestId(orderId: string, checkoutRequestId: string) {
  return prisma.storeOrder.update({ where: { id: orderId }, data: { mpesaCheckoutRequestId: checkoutRequestId } });
}

/**
 * Called from the M-Pesa callback handler (SYSTEM ctx, never a request
 * ctx). Idempotent: Daraja may deliver the same callback twice, and
 * postStoreSale's idempotencyKey guard makes a repeat a no-op.
 */
export async function confirmStoreOrderPayment(checkoutRequestId: string, mpesaReceiptCode: string) {
  const order = await prisma.storeOrder.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: { store: { include: { enterprise: true } } },
  });
  if (!order) throw new StoreOrderError('No order matches this payment', 'NOT_FOUND');
  if (order.status !== 'PENDING_PAYMENT') return order;

  const entry = await postStoreSale({
    storeOwnerPartyId: order.store.enterprise.partyId,
    totalKes: Number(order.totalKes),
    reference: `STORE-ORDER-${order.id}`,
    description: `Order ${order.id.slice(0, 8)} — ${order.store.name}`,
    idempotencyKey: checkoutRequestId,
  });

  const updated = await prisma.storeOrder.update({
    where: { id: order.id },
    data: { status: 'PAID', paidAt: new Date(), journalEntryId: entry.id },
  });

  if (order.customerId) {
    await earnLoyaltyForSale(order.storeId, order.customerId, Number(order.totalKes), { orderId: order.id });
  }

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'store_order.paid',
    targetType: 'store_order',
    targetId: order.id,
    payload: { mpesaReceiptCode },
  });

  return updated;
}

/**
 * Merchant confirms a cash-on-delivery order is paid — the counterpart to
 * the M-Pesa callback for a COD checkout. Posts the sale to the ledger
 * (the cash is now actually in) and flips the order to PAID. Idempotent
 * per order via the COD-{orderId} ledger key, so double-tapping the
 * button can't double-post.
 */
export async function confirmStoreOrderCod(ctx: Ctx, orderId: string) {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: { store: { include: { enterprise: true } } },
  });
  if (!order) throw new StoreOrderError('Order not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, order.storeId, 'order.fulfil');
  if (order.paymentMethod !== 'CASH_ON_DELIVERY') {
    throw new StoreOrderError('This order was paid with M-Pesa, not cash on delivery', 'PAYMENT_UNAVAILABLE');
  }
  if (order.status !== 'PENDING_PAYMENT') return order;

  const entry = await postStoreSale({
    storeOwnerPartyId: order.store.enterprise.partyId,
    totalKes: Number(order.totalKes),
    reference: `STORE-ORDER-${order.id}`,
    description: `Order ${order.id.slice(0, 8)} — ${order.store.name} (COD)`,
    idempotencyKey: `COD-${order.id}`,
  });

  const updated = await prisma.storeOrder.update({
    where: { id: order.id },
    data: { status: 'PAID', paidAt: new Date(), journalEntryId: entry.id },
  });

  if (order.customerId) {
    await earnLoyaltyForSale(order.storeId, order.customerId, Number(order.totalKes), { orderId: order.id });
  }

  await recordAudit(ctx, {
    action: 'store_order.paid',
    targetType: 'store_order',
    targetId: order.id,
    payload: { paymentMethod: 'CASH_ON_DELIVERY' },
  });

  return updated;
}

/** Order-status lookup for the buyer's own confirmation screen. No capability — order id is the secret. */
export async function getOrder(_ctx: Ctx, orderId: string) {
  return prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, store: true },
  });
}

export async function listStoreOrders(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'order.read');
  return prisma.storeOrder.findMany({
    where: { storeId },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function fulfilStoreOrder(ctx: Ctx, orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new StoreOrderError('Order not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, order.storeId, 'order.fulfil');
  const updated = await prisma.storeOrder.update({ where: { id: orderId }, data: { status: 'FULFILLED' } });
  await recordAudit(ctx, { action: 'store_order.fulfilled', targetType: 'store_order', targetId: orderId });
  return updated;
}

/* ── staff-wide order desk ───────────────────────────────────── */

export interface OrderDirectoryFilter {
  status?: StoreOrderStatus;
  needsReroute?: boolean;
  search?: string;
  take?: number;
  skip?: number;
}

/** Every order on the platform, not scoped to one store — the desk a
 *  support call works from: who ordered, from which shop, what state
 *  it's in, whether it's already flagged as stuck. */
export async function listAllOrdersForStaff(ctx: Ctx, f: OrderDirectoryFilter = {}) {
  requireCapability(ctx, 'order.read');
  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.needsReroute !== undefined ? { needsReroute: f.needsReroute } : {}),
    ...(f.search
      ? {
          OR: [
            { buyerName: { contains: f.search, mode: 'insensitive' as const } },
            { buyerMsisdn: { contains: f.search } },
            { store: { name: { contains: f.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.storeOrder.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, slug: true, status: true } },
        items: { include: { product: { select: { id: true, name: true, category: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.storeOrder.count({ where }),
  ]);
  return { rows, total };
}

/** Marks an order as needing a different vendor — the flag a support
 *  call raises when the original store can't deliver. Doesn't move
 *  anything by itself; see reassignOrder for the actual handoff. */
export async function flagOrderForReroute(ctx: Ctx, orderId: string, reason: string) {
  requireCapability(ctx, 'order.reroute');
  if (!reason.trim()) throw new Error('A reason is required to flag an order for reroute');
  if (!ctx.actorId) throw new Error('Flagging an order requires a named staff account');

  const order = await prisma.storeOrder.update({
    where: { id: orderId },
    data: { needsReroute: true, rerouteReason: reason, rerouteFlaggedById: ctx.actorId, rerouteFlaggedAt: new Date() },
  });
  await recordAudit(ctx, { action: 'store_order.flagged_for_reroute', targetType: 'store_order', targetId: orderId, payload: { reason } });
  return order;
}

export async function clearRerouteFlag(ctx: Ctx, orderId: string) {
  requireCapability(ctx, 'order.reroute');
  const order = await prisma.storeOrder.update({
    where: { id: orderId },
    data: { needsReroute: false, rerouteReason: null, rerouteFlaggedById: null, rerouteFlaggedAt: null },
  });
  await recordAudit(ctx, { action: 'store_order.reroute_cleared', targetType: 'store_order', targetId: orderId });
  return order;
}

/** Other active stores carrying a product with the same name as
 *  something in this order — the candidate list staff pick a new
 *  vendor from. Name-matched rather than a formal SKU link, since
 *  there is no shared-catalog concept between independent merchants. */
export async function findRerouteCandidates(ctx: Ctx, orderId: string) {
  requireCapability(ctx, 'order.reroute');
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId }, include: { items: { include: { product: true } } },
  });
  if (!order) throw new StoreOrderError('Order not found', 'NOT_FOUND');

  const names = [...new Set(order.items.map((i) => i.product.name))];
  const candidates = await prisma.store.findMany({
    where: {
      id: { not: order.storeId },
      status: 'ACTIVE',
      products: { some: { name: { in: names }, status: 'ACTIVE' } },
    },
    include: {
      products: { where: { name: { in: names }, status: 'ACTIVE' }, select: { id: true, name: true, priceKes: true, stockQty: true } },
      enterprise: { select: { party: { select: { person: true, organisation: true } } } },
    },
    take: 10,
  });
  return candidates.map((s) => ({
    id: s.id, name: s.name,
    owner: s.enterprise.party.person?.knownAs || s.enterprise.party.person?.officialName
      || s.enterprise.party.organisation?.knownAs || s.enterprise.party.organisation?.officialName || '—',
    matchingProducts: s.products,
  }));
}

/**
 * Hands an order to a different store. Only ever allowed before money
 * moves — PENDING_PAYMENT — because a PAID order already has a
 * JournalEntry crediting the original merchant's STORE_REVENUE account;
 * silently re-pointing it after that would corrupt the ledger's history
 * rather than correct it. A paid order that can't be fulfilled is a
 * refund/settlement conversation, not a reroute.
 *
 * Requires an exact-name product match in the destination store for
 * every item — the same reasoning as findRerouteCandidates: there's no
 * shared SKU between independent merchants to remap to automatically.
 */
export async function reassignOrder(ctx: Ctx, orderId: string, newStoreId: string) {
  requireCapability(ctx, 'order.reroute');

  return prisma.$transaction(async (tx) => {
    const order = await tx.storeOrder.findUnique({
      where: { id: orderId }, include: { items: { include: { product: true } } },
    });
    if (!order) throw new StoreOrderError('Order not found', 'NOT_FOUND');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new Error('Only an order still awaiting payment can be reassigned to another vendor');
    }

    const newStore = await tx.store.findUnique({ where: { id: newStoreId } });
    if (!newStore || newStore.status !== 'ACTIVE') throw new StoreOrderError('That store is not available', 'STORE_UNAVAILABLE');

    const replacements = await tx.product.findMany({
      where: { storeId: newStoreId, status: 'ACTIVE', name: { in: order.items.map((i) => i.product.name) } },
    });

    let totalKes = 0;
    for (const item of order.items) {
      const match = replacements.find((p) => p.name === item.product.name);
      if (!match) {
        throw new Error(`"${item.product.name}" isn't listed in that store — add it there first, or pick a different vendor`);
      }
      await tx.storeOrderItem.update({ where: { id: item.id }, data: { productId: match.id, unitPriceKes: match.priceKes } });
      totalKes += Number(match.priceKes) * item.quantity;
    }

    const updated = await tx.storeOrder.update({
      where: { id: orderId },
      data: {
        storeId: newStoreId, totalKes,
        needsReroute: false, rerouteReason: null, rerouteFlaggedById: null, rerouteFlaggedAt: null,
      },
    });

    await recordAudit(ctx, {
      action: 'store_order.reassigned', targetType: 'store_order', targetId: orderId,
      payload: { fromStoreId: order.storeId, toStoreId: newStoreId, totalKes },
    }, tx as never);

    return updated;
  });
}
