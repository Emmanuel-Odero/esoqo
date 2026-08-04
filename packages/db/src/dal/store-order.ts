import { prisma } from '../client';
import { systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { postStoreSale } from './_commerce-ledger';
import type { StoreOrderPaymentMethod } from '@prisma/client';

export class StoreOrderError extends Error {
  constructor(msg: string, public readonly code: 'STORE_UNAVAILABLE' | 'ITEM_UNAVAILABLE' | 'NOT_FOUND') {
    super(msg);
    this.name = 'StoreOrderError';
  }
}

export interface CreateOrderInput {
  storeSlug: string;
  buyerName: string;
  buyerMsisdn: string;
  paymentMethod: StoreOrderPaymentMethod;
  items: { productId: string; quantity: number }[];
}

/**
 * Public checkout. No capability required — a buyer need not be a
 * registered Esoko subject; ctx.partyId is attached when they are.
 */
export async function createStoreOrder(ctx: Ctx, input: CreateOrderInput) {
  const store = await prisma.store.findFirst({ where: { slug: input.storeSlug, status: 'ACTIVE' } });
  if (!store) throw new StoreOrderError('This store is not available', 'STORE_UNAVAILABLE');

  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, storeId: store.id, status: 'ACTIVE' },
  });
  if (products.length !== input.items.length) {
    throw new StoreOrderError('One of these items is no longer available', 'ITEM_UNAVAILABLE');
  }

  const items = input.items.map((i) => {
    const p = products.find((pr) => pr.id === i.productId)!;
    return { productId: p.id, quantity: i.quantity, unitPriceKes: p.priceKes };
  });
  const totalKes = items.reduce((sum, i) => sum + Number(i.unitPriceKes) * i.quantity, 0);

  const order = await prisma.storeOrder.create({
    data: {
      storeId: store.id,
      buyerPartyId: ctx.partyId ?? null,
      buyerName: input.buyerName,
      buyerMsisdn: input.buyerMsisdn,
      paymentMethod: input.paymentMethod,
      totalKes,
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

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'store_order.paid',
    targetType: 'store_order',
    targetId: order.id,
    payload: { mpesaReceiptCode },
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
