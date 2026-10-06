import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { findOrCreateSettlementAccount } from './treasury';
import type { EsoqoIdPurchaseKind, EsoqoIdSource, Prisma } from '@prisma/client';

/**
 * Buying a nicer esoqo ID than the free system-generated one — same
 * write-then-push-then-confirm shape as addSignatory/confirmSignatoryFeePayment
 * in treasury.ts, and the same FEE_INCOME posting: this is real platform
 * revenue, not pass-through (see platform-revenue.ts's own distinction).
 *
 * Gated behind ESOQO_ID_PREMIUM_ENABLED until pricing per kind is
 * decided — the model, allocator and STK plumbing exist so later UI work
 * isn't blocked on that decision, but initiateEsoqoIdPurchase refuses to
 * run until the flag is flipped on.
 */

export class EsoqoIdPurchaseError extends Error {
  constructor(msg: string, public readonly code: 'FLAG_DISABLED' | 'NOT_FOUND' | 'ALREADY_PENDING') {
    super(msg);
    this.name = 'EsoqoIdPurchaseError';
  }
}

function premiumEnabled(): boolean {
  return process.env.ESOQO_ID_PREMIUM_ENABLED === 'true';
}

/** Placeholder annual prices, one per kind — not yet product-confirmed.
 *  Kept as a single map so pricing is a one-line change, not a hunt
 *  through call sites, once real numbers land. */
export const ESOQO_ID_PURCHASE_PRICE_KES: Record<EsoqoIdPurchaseKind, number> = {
  FULL_NAME: 500,
  CUSTOM_DIGITS: 300,
  PHONE: 500,
  EMAIL: 500,
  RENEWAL: 300,
};

const KIND_TO_SOURCE: Record<EsoqoIdPurchaseKind, EsoqoIdSource> = {
  FULL_NAME: 'PREMIUM_FULL_NAME',
  CUSTOM_DIGITS: 'PREMIUM_CUSTOM',
  PHONE: 'PREMIUM_PHONE',
  EMAIL: 'PREMIUM_EMAIL',
  // A renewal keeps whatever source the handle already had — this row
  // is never read for RENEWAL, but the map must stay total.
  RENEWAL: 'PREMIUM_CUSTOM',
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type InitiatePurchaseResult =
  | { status: 'PENDING'; purchaseId: string }
  | { status: 'FLAG_DISABLED' };

/** Creates the PENDING row the STK push confirms into a live premium
 *  handle. Mirrors addSignatory: the row exists before any money moves,
 *  so a crash between this and Safaricom's callback can't lose track of
 *  the attempt. Does not itself call out to M-Pesa — same division of
 *  labour as actionAddSignatory, which owns initiateStkPush and then
 *  calls attachEsoqoIdPurchaseCheckoutRequestId below. */
export async function initiateEsoqoIdPurchase(
  ctx: Ctx, kind: EsoqoIdPurchaseKind, requestedHandle: string,
): Promise<InitiatePurchaseResult> {
  requireCapability(ctx, 'paymentid.issue', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in required');
  if (!premiumEnabled()) return { status: 'FLAG_DISABLED' };

  const esoqoPaymentId = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (!esoqoPaymentId) {
    throw new EsoqoIdPurchaseError('Activate a free esoqo ID before buying a premium one', 'NOT_FOUND');
  }

  const existingPending = await prisma.esoqoIdPurchase.findFirst({
    where: { partyId: ctx.partyId, status: 'PENDING' },
  });
  if (existingPending) {
    throw new EsoqoIdPurchaseError('A purchase is already in progress', 'ALREADY_PENDING');
  }

  const purchase = await prisma.esoqoIdPurchase.create({
    data: {
      partyId: ctx.partyId,
      esoqoId: ctx.partyId,
      kind,
      requestedHandle: requestedHandle.trim().toLowerCase(),
      amountKes: ESOQO_ID_PURCHASE_PRICE_KES[kind],
    },
  });
  await recordAudit(ctx, {
    action: 'esoqo_id_purchase.initiated', targetType: 'esoqo_id_purchase', targetId: purchase.id,
    payload: { kind },
  });
  return { status: 'PENDING', purchaseId: purchase.id };
}

export async function attachEsoqoIdPurchaseCheckoutRequestId(purchaseId: string, checkoutRequestId: string) {
  return prisma.esoqoIdPurchase.update({
    where: { id: purchaseId }, data: { mpesaCheckoutRequestId: checkoutRequestId },
  });
}

export async function failEsoqoIdPurchaseById(purchaseId: string, reason: string) {
  const purchase = await prisma.esoqoIdPurchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) throw new EsoqoIdPurchaseError('No purchase matches this', 'NOT_FOUND');
  if (purchase.status !== 'PENDING') return purchase;
  return prisma.esoqoIdPurchase.update({
    where: { id: purchase.id }, data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
  });
}

async function feeIncomeAccountId(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'FEE_INCOME' } });
  if (existing) return existing.id;
  return (await tx.account.create({ data: { partyId: null, kind: 'FEE_INCOME' } })).id;
}

/** Called from the M-Pesa callback, same idempotent-via-journal-entry
 *  shape confirmSignatoryFeePayment uses. A RENEWAL just pushes
 *  premiumExpiresAt out another year on the existing code; every other
 *  kind swaps the code itself to the requested handle. */
export async function confirmEsoqoIdPurchase(checkoutRequestId: string, mpesaReceiptCode: string) {
  const purchase = await prisma.esoqoIdPurchase.findUnique({ where: { mpesaCheckoutRequestId: checkoutRequestId } });
  if (!purchase) throw new EsoqoIdPurchaseError('No purchase matches this', 'NOT_FOUND');
  if (purchase.status !== 'PENDING') return { purchase, justConfirmed: false };

  const LOST_RACE = Symbol('esoqo id purchase already confirmed');
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.esoqoIdPurchase.updateMany({
        where: { id: purchase.id, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), mpesaReceiptCode: mpesaReceiptCode || null },
      });
      if (claimed.count === 0) throw LOST_RACE;

      const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: checkoutRequestId } });
      let entryId = existingEntry?.id;
      if (!entryId) {
        const feeIncome = await feeIncomeAccountId(tx);
        const settlement = await findOrCreateSettlementAccount(tx);
        const entry = await tx.journalEntry.create({
          data: {
            reference: `ESOQO-ID-PURCHASE-${purchase.id}`,
            description: 'Esoqo ID purchase',
            idempotencyKey: checkoutRequestId,
            postings: {
              create: [
                { accountId: feeIncome, amount: Number(purchase.amountKes) },
                { accountId: settlement.id, amount: -Number(purchase.amountKes) },
              ],
            },
          },
        });
        entryId = entry.id;
      }

      const expiresAt = new Date(Date.now() + ONE_YEAR_MS);
      await tx.esoqoIdPurchase.update({ where: { id: purchase.id }, data: { journalEntryId: entryId, expiresAt } });

      if (purchase.kind === 'RENEWAL') {
        await tx.esoqoPaymentId.update({
          where: { partyId: purchase.partyId }, data: { premiumExpiresAt: expiresAt, suspendedAt: null },
        });
      } else {
        await tx.esoqoPaymentId.update({
          where: { partyId: purchase.partyId },
          data: { code: purchase.requestedHandle, source: KIND_TO_SOURCE[purchase.kind], premiumExpiresAt: expiresAt, suspendedAt: null },
        });
      }
    });
  } catch (e) {
    if (e !== LOST_RACE) throw e;
    return { purchase: await prisma.esoqoIdPurchase.findUnique({ where: { id: purchase.id } }), justConfirmed: false };
  }

  return { purchase: await prisma.esoqoIdPurchase.findUnique({ where: { id: purchase.id } }), justConfirmed: true };
}

/** Whether a premium handle's paid year has run out — checked lazily
 *  wherever the handle matters (sign-in resolution, settings display),
 *  since nothing in this codebase runs on a schedule (see warehouse.ts's
 *  "billing is always manually triggered"). A SYSTEM_GENERATED handle
 *  (premiumExpiresAt null) never expires. */
export function isHandleExpired(esoqoPaymentId: { source: EsoqoIdSource; premiumExpiresAt: Date | null }): boolean {
  if (esoqoPaymentId.source === 'SYSTEM_GENERATED') return false;
  return Boolean(esoqoPaymentId.premiumExpiresAt && esoqoPaymentId.premiumExpiresAt < new Date());
}

/** How long an expired premium handle keeps working before the next
 *  read replaces it with a fresh free one — a window to renew without
 *  the ID going dead the instant the year is up. Not enforced by a
 *  cron; see reclaimExpiredHandleIfNeeded, which is the lazy check that
 *  actually applies it. */
export const HANDLE_EXPIRY_GRACE_DAYS = 30;

/** Called wherever a person's own handle is read (getMyPaymentId today).
 *  Past the grace window, swaps an expired premium code out for a fresh
 *  SYSTEM_GENERATED one rather than leaving a dead premium code in
 *  place — the person keeps an esoqo ID either way, just not the one
 *  they stopped paying for. */
export async function reclaimExpiredHandleIfNeeded(
  ctx: Ctx, esoqoPaymentId: { partyId: string; source: EsoqoIdSource; premiumExpiresAt: Date | null },
  names: string[],
) {
  if (esoqoPaymentId.source === 'SYSTEM_GENERATED' || !esoqoPaymentId.premiumExpiresAt) return null;
  const graceEnds = new Date(esoqoPaymentId.premiumExpiresAt.getTime() + HANDLE_EXPIRY_GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (graceEnds >= new Date()) return null;

  const { allocateEsoqoHandle } = await import('./payment-id');
  await prisma.esoqoPaymentId.delete({ where: { partyId: esoqoPaymentId.partyId } });
  const code = await allocateEsoqoHandle(esoqoPaymentId.partyId, names);
  await recordAudit(ctx, {
    action: 'esoqo_id_purchase.reclaimed', targetType: 'esoko_payment_id', targetId: esoqoPaymentId.partyId,
    payload: { newCode: code },
  });
  return code;
}
