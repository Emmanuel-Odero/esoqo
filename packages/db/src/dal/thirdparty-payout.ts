import { normaliseMsisdn } from '@esoqo/domain';
import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { feeForAmount } from './fees';
import { walletAccountId, settlementAccountId, feeIncomeAccountId } from './wallet-shared';
import { getWalletBalance } from './subject';

/**
 * A wallet holder paying an arbitrary M-Pesa number that is NOT another
 * Esoqo party — the one money-movement feature in this codebase that is
 * genuinely money-remittance-shaped rather than closed-loop commerce, even
 * under a generous reading. See docs/proposals/money-representation.md's
 * "Step 1c addendum".
 *
 * Gated behind THIRDPARTY_PAYOUT_ENABLED (default off) — same pattern
 * dal/esoqo-id-purchase.ts already uses for ESOQO_ID_PREMIUM_ENABLED: the
 * model, the DAL, and the B2C plumbing (reused wholesale from
 * dal/wallet-withdrawal.ts) exist so this isn't blocked later, but nothing
 * here runs until the flag is flipped on AND legal has signed off. No
 * apps/app UI exists for this yet, deliberately — see the plan this
 * shipped under.
 */

export class ThirdPartyPayoutError extends Error {
  code: 'FLAG_DISABLED' | 'AMOUNT_INVALID' | 'INVALID_MSISDN' | 'INSUFFICIENT_BALANCE' | 'VELOCITY_LIMIT' | 'NOT_FOUND';
  constructor(message: string, code: ThirdPartyPayoutError['code']) {
    super(message);
    this.code = code;
  }
}

function thirdPartyPayoutEnabled(): boolean {
  return process.env.THIRDPARTY_PAYOUT_ENABLED === 'true';
}

/**
 * Placeholder velocity limits, not yet compliance-confirmed — same
 * "one line to change, not a hunt through call sites" shape
 * ESOQO_ID_PURCHASE_PRICE_KES already uses. Two tiers, keyed to the trust
 * primitive this platform already has (Attestation) rather than a new
 * KYC concept: MSISDN_VERIFIED is the floor everyone with a Payment ID
 * already clears; NATIONAL_ID_CONFIRMED unlocks the higher tier.
 */
export const THIRDPARTY_PAYOUT_LIMITS = {
  MSISDN_VERIFIED: { perTransactionKes: 5_000, dailyKes: 10_000 },
  NATIONAL_ID_CONFIRMED: { perTransactionKes: 70_000, dailyKes: 150_000 },
} as const;

export type InitiateThirdPartyPayoutResult =
  | { status: 'PENDING'; payout: Awaited<ReturnType<typeof prisma.thirdPartyPayout.create>> }
  | { status: 'FLAG_DISABLED' };

async function velocityLimitFor(partyId: string): Promise<{ perTransactionKes: number; dailyKes: number }> {
  const idConfirmed = await prisma.attestation.findFirst({
    where: { subjectId: partyId, claimType: 'NATIONAL_ID_CONFIRMED', revokedAt: null },
  });
  return idConfirmed ? THIRDPARTY_PAYOUT_LIMITS.NATIONAL_ID_CONFIRMED : THIRDPARTY_PAYOUT_LIMITS.MSISDN_VERIFIED;
}

async function todaysTotalKes(partyId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows = await prisma.thirdPartyPayout.findMany({
    where: { partyId, createdAt: { gte: since }, status: { in: ['PENDING', 'CONFIRMED'] } },
    select: { amountKes: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.amountKes), 0);
}

export async function createThirdPartyPayout(
  ctx: Ctx, input: { payeeMsisdn: string; amountKes: number },
): Promise<InitiateThirdPartyPayoutResult> {
  if (!ctx.partyId) throw new ThirdPartyPayoutError('Sign in required', 'NOT_FOUND');
  requireCapability(ctx, 'wallet.thirdpartypayout', { partyId: ctx.partyId });
  if (!thirdPartyPayoutEnabled()) return { status: 'FLAG_DISABLED' };

  const amount = Number(input.amountKes);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ThirdPartyPayoutError('Enter an amount above zero', 'AMOUNT_INVALID');
  }
  const payeeMsisdn = normaliseMsisdn(input.payeeMsisdn);
  if (!payeeMsisdn) {
    throw new ThirdPartyPayoutError('Enter the M-Pesa number to pay', 'INVALID_MSISDN');
  }

  const limit = await velocityLimitFor(ctx.partyId);
  if (amount > limit.perTransactionKes) {
    throw new ThirdPartyPayoutError(
      `This account can send up to KES ${limit.perTransactionKes.toLocaleString('en-KE')} per payout`,
      'VELOCITY_LIMIT',
    );
  }
  const sentToday = await todaysTotalKes(ctx.partyId);
  if (sentToday + amount > limit.dailyKes) {
    throw new ThirdPartyPayoutError(
      `This account can send up to KES ${limit.dailyKes.toLocaleString('en-KE')} a day — `
        + `KES ${sentToday.toLocaleString('en-KE')} already sent today`,
      'VELOCITY_LIMIT',
    );
  }

  const balance = await getWalletBalance(ctx);
  if (amount > balance) {
    throw new ThirdPartyPayoutError(
      `Your wallet balance is KES ${balance.toLocaleString('en-KE')} — you can't send more than that`,
      'INSUFFICIENT_BALANCE',
    );
  }

  const feeKes = await feeForAmount('THIRDPARTY_PAYOUT', amount);
  const netPayoutKes = amount - feeKes;
  if (netPayoutKes <= 0) {
    throw new ThirdPartyPayoutError('The fee for that amount leaves nothing to send — try a larger amount', 'AMOUNT_INVALID');
  }

  const payout = await prisma.thirdPartyPayout.create({
    data: { partyId: ctx.partyId, payeeMsisdn, amountKes: amount, feeKes, netPayoutKes },
  });

  await recordAudit(ctx, {
    action: 'wallet.thirdparty_payout_requested',
    targetType: 'thirdparty_payout',
    targetId: payout.id,
    payload: { amountKes: amount, feeKes, netPayoutKes },
  });

  return { status: 'PENDING', payout };
}

export async function attachThirdPartyPayoutConversationId(payoutId: string, conversationId: string) {
  return prisma.thirdPartyPayout.update({ where: { id: payoutId }, data: { mpesaConversationId: conversationId } });
}

export async function failThirdPartyPayoutById(payoutId: string, reason: string) {
  const payout = await prisma.thirdPartyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new ThirdPartyPayoutError('No payout matches this payment', 'NOT_FOUND');
  if (payout.status !== 'PENDING') return payout;
  return prisma.thirdPartyPayout.update({
    where: { id: payout.id },
    data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
  });
}

export interface ConfirmThirdPartyPayoutResult {
  payout: Awaited<ReturnType<typeof prisma.thirdPartyPayout.update>>;
  justConfirmed: boolean;
}

/** Same shape as confirmWalletWithdrawal — reused wholesale rather than
 *  duplicated by design, since the settlement mechanics ("debit WALLET,
 *  credit SETTLEMENT for what left, credit FEE_INCOME for the fee") don't
 *  change when the payee is a third party instead of the sender's own
 *  number. */
export async function confirmThirdPartyPayout(
  conversationId: string,
  mpesaTransactionId: string,
): Promise<ConfirmThirdPartyPayoutResult> {
  const payout = await prisma.thirdPartyPayout.findUnique({ where: { mpesaConversationId: conversationId } });
  if (!payout) throw new ThirdPartyPayoutError('No payout matches this payment', 'NOT_FOUND');
  if (payout.status !== 'PENDING') {
    if (payout.status === 'CONFIRMED' && mpesaTransactionId && !payout.mpesaTransactionId) {
      return {
        payout: await prisma.thirdPartyPayout.update({ where: { id: payout.id }, data: { mpesaTransactionId } }),
        justConfirmed: false,
      };
    }
    return { payout, justConfirmed: false };
  }

  const amount = Number(payout.amountKes);
  const feeKes = Number(payout.feeKes);
  const netPayoutKes = Number(payout.netPayoutKes);

  const LOST_RACE = Symbol('thirdparty payout already confirmed');

  let updated: ConfirmThirdPartyPayoutResult['payout'];
  try {
    updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.thirdPartyPayout.updateMany({
        where: { id: payout.id, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), mpesaTransactionId: mpesaTransactionId || null },
      });
      if (claimed.count === 0) throw LOST_RACE;

      const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: conversationId } });
      let entryId = existingEntry?.id;
      if (!entryId) {
        const [wallet, settlement, feeIncome] = await Promise.all([
          walletAccountId(tx, payout.partyId),
          settlementAccountId(tx),
          feeKes > 0 ? feeIncomeAccountId(tx) : Promise.resolve(null),
        ]);
        const entry = await tx.journalEntry.create({
          data: {
            reference: `THIRDPARTY-PAYOUT-${payout.id}`,
            description: 'Third-party M-Pesa payout',
            idempotencyKey: conversationId,
            postings: {
              create: [
                { accountId: wallet, amount: -amount },
                { accountId: settlement, amount: netPayoutKes },
                ...(feeIncome ? [{ accountId: feeIncome, amount: feeKes }] : []),
              ],
            },
          },
        });
        entryId = entry.id;
      }
      return tx.thirdPartyPayout.update({ where: { id: payout.id }, data: { journalEntryId: entryId } });
    });
  } catch (e) {
    if (e !== LOST_RACE) throw e;
    const settled = await prisma.thirdPartyPayout.findUnique({ where: { id: payout.id } });
    return { payout: settled!, justConfirmed: false };
  }

  await recordAudit(systemCtx('mpesa-b2c-callback'), {
    action: 'wallet.thirdparty_payout_confirmed',
    targetType: 'thirdparty_payout',
    targetId: payout.id,
    payload: { mpesaTransactionId, partyId: payout.partyId, amountKes: amount, feeKes, netPayoutKes },
  });

  return { payout: updated, justConfirmed: true };
}
