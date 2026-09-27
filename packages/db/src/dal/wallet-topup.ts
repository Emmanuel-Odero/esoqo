import { normaliseMsisdn } from '@esoqo/domain';
import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { Prisma } from '@prisma/client';

/**
 * Cash a person adds to their own personal WALLET Account via M-Pesa
 * STK push. Deliberately the same shape as BusinessPayment
 * (dal/business-payment.ts) — write the row, push, attach the
 * checkoutRequestId, confirm once (console mode) or on the Safaricom
 * callback (production) — because the settlement mechanics of "money
 * arrives via STK and needs one balanced ledger entry, confirmed
 * exactly once" don't change when the payee is the payer's own
 * account instead of a business's.
 */

export const MAX_TOPUP_KES = 300_000;

export class WalletTopUpError extends Error {
  code: 'AMOUNT_INVALID' | 'INVALID_MSISDN' | 'NOT_FOUND';
  constructor(message: string, code: WalletTopUpError['code']) {
    super(message);
    this.code = code;
  }
}

export async function createWalletTopUp(ctx: Ctx, input: { amountKes: number; msisdn: string }) {
  if (!ctx.partyId) throw new WalletTopUpError('Not signed in', 'INVALID_MSISDN');
  requireCapability(ctx, 'entity.write', { partyId: ctx.partyId });

  const amount = Number(input.amountKes);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TOPUP_KES) {
    throw new WalletTopUpError(
      `Enter an amount above zero and below KES ${MAX_TOPUP_KES.toLocaleString('en-KE')}`,
      'AMOUNT_INVALID',
    );
  }
  const msisdn = normaliseMsisdn(input.msisdn);
  if (!msisdn) throw new WalletTopUpError('Enter the M-Pesa number to pay from', 'INVALID_MSISDN');

  const topUp = await prisma.walletTopUp.create({
    data: { partyId: ctx.partyId, msisdn, amountKes: amount },
  });

  await recordAudit(ctx, {
    action: 'wallet_top_up.created',
    targetType: 'wallet_top_up',
    targetId: topUp.id,
    payload: { amountKes: amount },
  });
  return topUp;
}

export async function attachWalletTopUpCheckoutRequestId(topUpId: string, checkoutRequestId: string) {
  return prisma.walletTopUp.update({
    where: { id: topUpId },
    data: { mpesaCheckoutRequestId: checkoutRequestId },
  });
}

/** For a push that never came back — same reason failBusinessPaymentById
 *  exists: the row is written before the push is attempted, so a
 *  rejected/undeliverable prompt must be marked FAILED explicitly or it
 *  sits PENDING forever looking like unsettled money. */
export async function failWalletTopUpById(topUpId: string, reason: string) {
  const topUp = await prisma.walletTopUp.findUnique({ where: { id: topUpId } });
  if (!topUp) throw new WalletTopUpError('No wallet top-up matches this payment', 'NOT_FOUND');
  if (topUp.status !== 'PENDING') return topUp;
  return prisma.walletTopUp.update({
    where: { id: topUp.id },
    data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
  });
}

async function walletAccountId(tx: Prisma.TransactionClient, partyId: string): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId, kind: 'WALLET', currency: 'KES' } });
  if (existing) return existing.id;
  const created = await tx.account.create({ data: { partyId, kind: 'WALLET', currency: 'KES' } });
  return created.id;
}

async function settlementAccountId(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  if (existing) return existing.id;
  const created = await tx.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  return created.id;
}

export interface ConfirmWalletTopUpResult {
  topUp: Awaited<ReturnType<typeof prisma.walletTopUp.update>>;
  /** False on an idempotent replay — Safaricom delivers the same
   *  callback more than once. */
  justConfirmed: boolean;
}

/**
 * Called from the M-Pesa callback handler (SYSTEM ctx) — or, in
 * console mode where there is no callback, immediately after the push.
 * Idempotent via the JournalEntry's idempotencyKey, exactly as
 * confirmBusinessPayment is. Posts the person's own WALLET account
 * +amount against the platform SETTLEMENT account -amount.
 */
export async function confirmWalletTopUp(
  checkoutRequestId: string,
  mpesaReceiptCode: string,
): Promise<ConfirmWalletTopUpResult> {
  const topUp = await prisma.walletTopUp.findUnique({ where: { mpesaCheckoutRequestId: checkoutRequestId } });
  if (!topUp) throw new WalletTopUpError('No wallet top-up matches this payment', 'NOT_FOUND');
  if (topUp.status !== 'PENDING') {
    if (topUp.status === 'CONFIRMED' && mpesaReceiptCode && !topUp.mpesaReceiptCode) {
      return {
        topUp: await prisma.walletTopUp.update({ where: { id: topUp.id }, data: { mpesaReceiptCode } }),
        justConfirmed: false,
      };
    }
    return { topUp, justConfirmed: false };
  }

  const amount = Number(topUp.amountKes);

  // Thrown to abandon the transaction when another confirmer got there
  // first — same "claim via the status column" lock confirmBusinessPayment
  // uses, for the same reason: two paths (the callback and the waiting
  // screen's own status check) can both observe PENDING at once.
  const LOST_RACE = Symbol('wallet top-up already confirmed');

  let updated: ConfirmWalletTopUpResult['topUp'];
  try {
    updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletTopUp.updateMany({
        where: { id: topUp.id, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), mpesaReceiptCode: mpesaReceiptCode || null },
      });
      if (claimed.count === 0) throw LOST_RACE;

      const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: checkoutRequestId } });
      let entryId = existingEntry?.id;
      if (!entryId) {
        const [wallet, settlement] = await Promise.all([
          walletAccountId(tx, topUp.partyId),
          settlementAccountId(tx),
        ]);
        const entry = await tx.journalEntry.create({
          data: {
            reference: `WALLET-TOPUP-${topUp.id}`,
            description: 'Wallet top-up',
            idempotencyKey: checkoutRequestId,
            postings: {
              create: [
                { accountId: wallet, amount },
                { accountId: settlement, amount: -amount },
              ],
            },
          },
        });
        entryId = entry.id;
      }
      return tx.walletTopUp.update({ where: { id: topUp.id }, data: { journalEntryId: entryId } });
    });
  } catch (e) {
    if (e !== LOST_RACE) throw e;
    const settled = await prisma.walletTopUp.findUnique({ where: { id: topUp.id } });
    return { topUp: settled!, justConfirmed: false };
  }

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'wallet_top_up.confirmed',
    targetType: 'wallet_top_up',
    targetId: topUp.id,
    payload: { mpesaReceiptCode, partyId: topUp.partyId, amountKes: amount },
  });

  return { topUp: updated, justConfirmed: true };
}
