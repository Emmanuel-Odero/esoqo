import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import type { Prisma } from '@prisma/client';

/**
 * Receipts.
 *
 * receiptNo is globally unique (the schema's own constraint) but reads
 * as sequential per store — "000147" means the 147th receipt THIS shop
 * has issued, not the platform's. So it's store-slug-prefixed: unique
 * across every store, still a small clean number to the merchant who
 * only ever sees their own. See nextReceiptNo.
 *
 * etimsSerial is deliberately never generated here. A real KRA eTIMS
 * serial comes from KRA's own fiscal device/OSCU-VSCU integration —
 * cryptographically signed, submitted to KRA, and only THEN valid. This
 * package has no such integration. Inventing a serial that merely looks
 * right would let a merchant hand a customer a receipt that claims
 * eTIMS compliance it doesn't have — worse than no serial at all. So
 * issueReceipt only ever stores an etimsSerial it was actually given by
 * a caller wired to a real KRA integration; until one exists, it stays
 * null and Store.etimsEnabled means "wants this," not "has this."
 */

export class ReceiptError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'BAD_INPUT') {
    super(msg);
    this.name = 'ReceiptError';
  }
}

async function nextReceiptNo(tx: Prisma.TransactionClient, storeId: string, storeSlug: string): Promise<string> {
  const prefix = storeSlug.slice(0, 12).toUpperCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await tx.receipt.count({ where: { storeId } });
    const candidate = `${prefix}-${String(count + 1).padStart(6, '0')}`;
    const clash = await tx.receipt.findUnique({ where: { receiptNo: candidate } });
    if (!clash) return candidate;
  }
  // Astronomically unlikely to fall through five attempts — fall back to
  // something guaranteed unique rather than fail the receipt entirely.
  return `${prefix}-${Date.now()}`;
}

export interface IssueReceiptInput {
  saleId?: string;
  orderId?: string;
  /** PRINT | SMS. WhatsApp isn't wired to a provider yet. */
  channel: 'PRINT' | 'SMS';
  /** The customer's phone, for an SMS copy — ignored for PRINT. */
  sentTo?: string;
  /** Only ever set by a real KRA eTIMS integration — see the module note above. */
  etimsSerial?: string;
}

export async function issueReceipt(ctx: Ctx, storeId: string, input: IssueReceiptInput) {
  const store = await assertOwnsStore(ctx, storeId, 'receipt.write');
  if (!input.saleId && !input.orderId) throw new ReceiptError('A receipt needs a sale or an order', 'BAD_INPUT');
  if (input.channel === 'SMS' && !input.sentTo) throw new ReceiptError('An SMS receipt needs a phone number', 'BAD_INPUT');

  let totalKes: number;
  if (input.saleId) {
    const sale = await prisma.posSale.findUnique({ where: { id: input.saleId } });
    if (!sale || sale.storeId !== storeId) throw new ReceiptError('Sale not found', 'NOT_FOUND');
    totalKes = Number(sale.totalKes);
  } else {
    const order = await prisma.storeOrder.findUnique({ where: { id: input.orderId } });
    if (!order || order.storeId !== storeId) throw new ReceiptError('Order not found', 'NOT_FOUND');
    totalKes = Number(order.totalKes);
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const receiptNo = await nextReceiptNo(tx, storeId, store.slug);
    return tx.receipt.create({
      data: {
        storeId,
        receiptNo,
        saleId: input.saleId ?? null,
        orderId: input.orderId ?? null,
        totalKes,
        etimsSerial: store.etimsEnabled ? (input.etimsSerial ?? null) : null,
        channel: input.channel,
        sentTo: input.channel === 'SMS' ? input.sentTo : null,
      },
    });
  });

  await recordAudit(ctx, {
    action: 'receipt.issued', targetType: 'receipt', targetId: receipt.id,
    payload: { storeId, saleId: input.saleId, orderId: input.orderId, channel: input.channel },
  });
  // storeName rides along because the SMS copy leads with it (see
  // domain/store-notify.ts) and the caller composing that message would
  // otherwise have to re-fetch the store this function already loaded.
  return { ...receipt, storeName: store.name };
}

export async function listReceiptsForSale(ctx: Ctx, storeId: string, saleId: string) {
  await assertOwnsStore(ctx, storeId, 'receipt.write');
  return prisma.receipt.findMany({ where: { storeId, saleId }, orderBy: { issuedAt: 'desc' } });
}

export async function getReceipt(ctx: Ctx, receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      store: true,
      sale: { include: { items: { include: { product: true, variant: true } }, cashier: true } },
      order: { include: { items: { include: { product: true } } } },
    },
  });
  if (!receipt) throw new ReceiptError('Receipt not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, receipt.storeId, 'receipt.write');
  return receipt;
}
