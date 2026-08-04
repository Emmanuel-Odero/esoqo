import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { postStoreSale } from './_commerce-ledger';
import type { PosPaymentMethod } from '@prisma/client';

export interface PosSaleInput {
  /** Generated on-device at the moment of sale, offline or not — the offline outbox's idempotency key. */
  clientSaleId: string;
  paymentMethod: PosPaymentMethod;
  soldAt: string; // ISO — when it happened on the device, not when it synced
  items: { productId: string; quantity: number; unitPriceKes: number }[];
}

/**
 * Records a PoS sale. Safe to call twice with the same clientSaleId —
 * that's what lets the offline outbox retry a sync without risk. Cash
 * sales post to the ledger immediately; M-Pesa till sales post the same
 * way once the merchant confirms the till alert (no callback exists for
 * a till payment the way STK push has one, so confirmation is manual).
 */
export async function recordPosSale(ctx: Ctx, storeId: string, input: PosSaleInput) {
  const store = await assertOwnsStore(ctx, storeId, 'pos.sell');

  const existing = await prisma.posSale.findUnique({ where: { clientSaleId: input.clientSaleId } });
  if (existing) return existing;

  const totalKes = input.items.reduce((sum, i) => sum + i.unitPriceKes * i.quantity, 0);

  const sale = await prisma.posSale.create({
    data: {
      storeId,
      clientSaleId: input.clientSaleId,
      paymentMethod: input.paymentMethod,
      totalKes,
      soldAt: new Date(input.soldAt),
      syncStatus: 'SYNCED',
      items: {
        create: input.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceKes: i.unitPriceKes,
        })),
      },
    },
    include: { items: true },
  });

  const entry = await postStoreSale({
    storeOwnerPartyId: store.enterprise.partyId,
    totalKes,
    reference: `POS-SALE-${sale.id}`,
    description: `PoS sale — ${store.name}`,
    idempotencyKey: input.clientSaleId,
  });
  await prisma.posSale.update({ where: { id: sale.id }, data: { journalEntryId: entry.id } });

  await recordAudit(ctx, {
    action: 'pos_sale.recorded',
    targetType: 'pos_sale',
    targetId: sale.id,
    payload: { storeId, totalKes, paymentMethod: input.paymentMethod },
  });

  return sale;
}

export async function listPosSales(ctx: Ctx, storeId: string, take = 50) {
  await assertOwnsStore(ctx, storeId, 'order.read');
  return prisma.posSale.findMany({
    where: { storeId },
    include: { items: { include: { product: true } } },
    orderBy: { soldAt: 'desc' },
    take,
  });
}
