import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { postStoreSale } from './_commerce-ledger';
import { findOrCreateCustomer, chargeCustomerForSale, earnLoyaltyForSale } from './customer';
import type { PosPaymentMethod } from '@prisma/client';

/** Stock at or below this after a sale gets flagged back to the terminal —
 *  same threshold getStoreAnalyticsForStaff already uses for the low-stock
 *  list, so "low" means the same thing everywhere in the product. */
const LOW_STOCK_THRESHOLD = 5;

export class PosSaleError extends Error {
  constructor(msg: string, public readonly code: 'EMPTY_SALE' | 'SHORT_TENDER' | 'ON_ACCOUNT_NEEDS_CUSTOMER') {
    super(msg);
    this.name = 'PosSaleError';
  }
}

export interface PosSaleItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  /** What this line actually sold for — the catalog price is only ever a
   *  starting point here. A milk vendor's litre is KES 60 today, KES 40
   *  tomorrow; a tomato buyer haggles every single time. The terminal
   *  sends whatever price the cashier and customer actually agreed. */
  unitPriceKes: number;
  /** Extra reduction on top of unitPriceKes, kept separate so a receipt
   *  can still show "regular price, then knocked off X" rather than
   *  silently rewriting the price. */
  discountKes?: number;
}

export interface PosSaleInput {
  /** Generated on-device at the moment of sale, offline or not — the offline outbox's idempotency key. */
  clientSaleId: string;
  paymentMethod: PosPaymentMethod;
  soldAt: string; // ISO — when it happened on the device, not when it synced
  items: PosSaleItemInput[];
  /** Whole-receipt discount, on top of any per-line discounts. */
  discountKes?: number;
  /** Cash handed over — only meaningful for CASH sales. Drives changeKes. */
  tenderedKes?: number;
  cashierId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  /** Auto-captures (or matches) a StoreCustomer by phone when customerId
   *  isn't already known — required for ON_ACCOUNT, optional otherwise
   *  (a cash sale can still be tagged to a customer for loyalty points). */
  customerMsisdn?: string | null;
  customerName?: string | null;
}

export interface LowStockLine { productId: string; name: string; remainingQty: number }

/**
 * Records a PoS sale. Safe to call twice with the same clientSaleId —
 * that's what lets the offline outbox retry a sync without risk. Cash
 * sales post to the ledger immediately; M-Pesa till sales post the same
 * way once the merchant confirms the till alert (no callback exists for
 * a till payment the way STK push has one, so confirmation is manual).
 *
 * Stock is decremented, clamped at zero — never blocked. The sale already
 * happened at the counter before anyone opened this app; refusing to
 * record it because the software's count disagrees would just mean the
 * merchant stops trusting the software, not that they stop selling milk.
 * What the caller gets back instead is `lowStock`, so the terminal can
 * flash a restock reminder right after the sale that caused it.
 */
export async function recordPosSale(ctx: Ctx, storeId: string, input: PosSaleInput) {
  const store = await assertOwnsStore(ctx, storeId, 'pos.sell');

  const existing = await prisma.posSale.findUnique({ where: { clientSaleId: input.clientSaleId } });
  if (existing) return { sale: existing, lowStock: [] as LowStockLine[] };

  if (input.items.length === 0) throw new PosSaleError('A sale needs at least one item', 'EMPTY_SALE');

  let customerId = input.customerId ?? null;
  if (!customerId && input.customerMsisdn) {
    const customer = await findOrCreateCustomer(storeId, input.customerMsisdn, input.customerName);
    customerId = customer.id;
  }
  if (input.paymentMethod === 'ON_ACCOUNT' && !customerId) {
    throw new PosSaleError('An on-account sale needs a customer — enter their phone number', 'ON_ACCOUNT_NEEDS_CUSTOMER');
  }

  const lineDiscountTotal = input.items.reduce((sum, i) => sum + (i.discountKes ?? 0), 0);
  const grossKes = input.items.reduce((sum, i) => sum + i.unitPriceKes * i.quantity, 0);
  const saleDiscountKes = input.discountKes ?? 0;
  const totalKes = Math.max(0, grossKes - lineDiscountTotal - saleDiscountKes);

  let changeKes: number | null = null;
  if (input.paymentMethod === 'CASH' && input.tenderedKes != null) {
    if (input.tenderedKes < totalKes) {
      throw new PosSaleError(
        `Amount tendered (KES ${input.tenderedKes}) is less than the total (KES ${totalKes})`,
        'SHORT_TENDER',
      );
    }
    changeKes = Math.round((input.tenderedKes - totalKes) * 100) / 100;
  }

  // Cost snapshot per line, from whichever catalog price the item resolves
  // to right now — a later price/cost edit must never rewrite history.
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const variantIds = [...new Set(input.items.map((i) => i.variantId).filter((v): v is string => Boolean(v)))];
  const [products, variants] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, costKes: true, stockQty: true } }),
    variantIds.length
      ? prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, costKes: true, stockQty: true } })
      : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const { sale, lowStock } = await prisma.$transaction(async (tx) => {
    const created = await tx.posSale.create({
      data: {
        storeId,
        clientSaleId: input.clientSaleId,
        paymentMethod: input.paymentMethod,
        totalKes,
        discountKes: saleDiscountKes,
        tenderedKes: input.tenderedKes ?? null,
        changeKes,
        soldAt: new Date(input.soldAt),
        syncStatus: 'SYNCED',
        cashierId: input.cashierId ?? null,
        shiftId: input.shiftId ?? null,
        customerId,
        items: {
          create: input.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId ?? null,
            quantity: i.quantity,
            unitPriceKes: i.unitPriceKes,
            discountKes: i.discountKes ?? 0,
            costKes: (i.variantId ? variantById.get(i.variantId)?.costKes : productById.get(i.productId)?.costKes) ?? null,
          })),
        },
      },
      include: { items: true },
    });

    const low: LowStockLine[] = [];
    for (const i of input.items) {
      if (i.variantId) {
        const v = variantById.get(i.variantId);
        if (v && v.stockQty !== null) {
          const remainingQty = Math.max(0, v.stockQty - i.quantity);
          await tx.productVariant.update({ where: { id: i.variantId }, data: { stockQty: remainingQty } });
          if (remainingQty <= LOW_STOCK_THRESHOLD) {
            const p = productById.get(i.productId);
            low.push({ productId: i.productId, name: p?.name ?? 'Item', remainingQty });
          }
        }
      } else {
        const p = productById.get(i.productId);
        if (p && p.stockQty !== null) {
          const remainingQty = Math.max(0, p.stockQty - i.quantity);
          await tx.product.update({ where: { id: i.productId }, data: { stockQty: remainingQty } });
          if (remainingQty <= LOW_STOCK_THRESHOLD) low.push({ productId: i.productId, name: p.name, remainingQty });
        }
      }
    }

    return { sale: created, lowStock: low };
  });

  // ON_ACCOUNT: goods left the shop, no cash arrived — this goes onto the
  // credit book instead of the commerce ledger. The commerce ledger only
  // sees the money once it's actually collected, via recordCustomerPayment.
  if (input.paymentMethod === 'ON_ACCOUNT') {
    await chargeCustomerForSale(customerId!, sale.id, totalKes);
  } else {
    const entry = await postStoreSale({
      storeOwnerPartyId: store.enterprise.partyId,
      totalKes,
      reference: `POS-SALE-${sale.id}`,
      description: `PoS sale — ${store.name}`,
      idempotencyKey: input.clientSaleId,
    });
    await prisma.posSale.update({ where: { id: sale.id }, data: { journalEntryId: entry.id } });
  }

  // Loyalty is earned on the purchase itself, not on when it's paid off —
  // an on-account sale still earns points the moment the goods are sold.
  if (customerId) await earnLoyaltyForSale(storeId, customerId, totalKes, { saleId: sale.id });

  await recordAudit(ctx, {
    action: 'pos_sale.recorded',
    targetType: 'pos_sale',
    targetId: sale.id,
    payload: { storeId, totalKes, discountKes: saleDiscountKes, paymentMethod: input.paymentMethod },
  });

  return { sale, lowStock };
}

export async function listPosSales(ctx: Ctx, storeId: string, take = 50) {
  await assertOwnsStore(ctx, storeId, 'order.read');
  return prisma.posSale.findMany({
    where: { storeId },
    include: { items: { include: { product: true, variant: true } }, cashier: true, customer: true },
    orderBy: { soldAt: 'desc' },
    take,
  });
}
