import { generateTransactionCode, TRANSACTION_CODE_KINDS } from '@esoqo/domain';
import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { feeForAmount } from './fees';
import { walletAccountId, settlementAccountId, feeIncomeAccountId } from './wallet-shared';
import { getWalletBalance } from './subject';
import { isUniqueViolation } from './payment-id';

/**
 * Cashing a WALLET balance back out to M-Pesa via Daraja B2C — the reverse
 * of WalletTopUp (dal/wallet-topup.ts), and deliberately similar in shape:
 * write the row, push, attach the conversation id, confirm once (console
 * mode) or on Safaricom's B2C result callback (production).
 *
 * The one rule that makes a withdrawal safe rather than just convenient:
 * `msisdn` is ALWAYS Person.msisdn, resolved server-side. There is no
 * parameter for it anywhere in this file — a caller cannot supply a
 * different number no matter what a tampered request sends, because there
 * is nowhere in the function signature for one to go.
 */

export class WalletWithdrawalError extends Error {
  code: 'AMOUNT_INVALID' | 'NOT_VERIFIED' | 'INSUFFICIENT_BALANCE' | 'NOT_FOUND';
  constructor(message: string, code: WalletWithdrawalError['code']) {
    super(message);
    this.code = code;
  }
}

export async function createWalletWithdrawal(ctx: Ctx, input: { amountKes: number }) {
  if (!ctx.partyId) throw new WalletWithdrawalError('Sign in required', 'NOT_VERIFIED');
  requireCapability(ctx, 'wallet.withdraw', { partyId: ctx.partyId });

  const amount = Number(input.amountKes);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WalletWithdrawalError('Enter an amount above zero', 'AMOUNT_INVALID');
  }

  const person = await prisma.person.findUnique({
    where: { partyId: ctx.partyId },
    select: { msisdn: true },
  });
  const msisdn = person?.msisdn;
  if (!msisdn) {
    throw new WalletWithdrawalError(
      'Verify your phone number before withdrawing — a withdrawal can only go to the M-Pesa number you registered with',
      'NOT_VERIFIED',
    );
  }

  const balance = await getWalletBalance(ctx);
  if (amount > balance) {
    throw new WalletWithdrawalError(
      `Your wallet balance is KES ${balance.toLocaleString('en-KE')} — you can't withdraw more than that`,
      'INSUFFICIENT_BALANCE',
    );
  }

  const feeKes = await feeForAmount('WALLET_WITHDRAWAL', amount);
  const netPayoutKes = amount - feeKes;
  if (netPayoutKes <= 0) {
    throw new WalletWithdrawalError('The fee for that amount leaves nothing to send — try a larger amount', 'AMOUNT_INVALID');
  }

  // Minted before the B2C push, same reasoning as createWalletTopUp:
  // there is a reference to quote for support even if the push is never
  // confirmed.
  for (let attempt = 0; attempt < 5; attempt++) {
    const referenceCode = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_WITHDRAWAL);
    try {
      const withdrawal = await prisma.walletWithdrawal.create({
        data: { partyId: ctx.partyId, msisdn, amountKes: amount, feeKes, netPayoutKes, referenceCode },
      });
      await recordAudit(ctx, {
        action: 'wallet.withdrawal_requested',
        targetType: 'wallet_withdrawal',
        targetId: withdrawal.id,
        payload: { amountKes: amount, feeKes, netPayoutKes, referenceCode },
      });
      return withdrawal;
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 4) throw e;
    }
  }
  throw new Error('Could not start this withdrawal — try again');
}

export async function attachWalletWithdrawalConversationId(withdrawalId: string, conversationId: string) {
  return prisma.walletWithdrawal.update({
    where: { id: withdrawalId },
    data: { mpesaConversationId: conversationId },
  });
}

/** For a B2C request that never came back (the push itself threw) — same
 *  reason failWalletTopUpById exists: the row is written before the push
 *  is attempted, so a rejected request must be marked FAILED explicitly or
 *  it sits PENDING forever looking like money that is still on its way. */
export async function failWalletWithdrawalById(withdrawalId: string, reason: string) {
  const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new WalletWithdrawalError('No withdrawal matches this payment', 'NOT_FOUND');
  if (withdrawal.status !== 'PENDING') return withdrawal;
  return prisma.walletWithdrawal.update({
    where: { id: withdrawal.id },
    data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
  });
}

export interface ConfirmWalletWithdrawalResult {
  withdrawal: Awaited<ReturnType<typeof prisma.walletWithdrawal.update>>;
  /** False on an idempotent replay — Daraja can deliver the same result
   *  callback more than once. */
  justConfirmed: boolean;
}

/**
 * Called from the B2C result-callback handler (SYSTEM ctx) — or, in
 * console mode, immediately after the push. Idempotent via the
 * JournalEntry's idempotencyKey, exactly as confirmWalletTopUp is.
 *
 * Posts a debit to WALLET (money leaving the balance), a credit to
 * SETTLEMENT for what actually left via B2C, and — only when a fee was
 * charged — a credit to FEE_INCOME. Mirrors confirmWalletTopUp's postings
 * in reverse.
 */
export async function confirmWalletWithdrawal(
  conversationId: string,
  mpesaTransactionId: string,
): Promise<ConfirmWalletWithdrawalResult> {
  const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { mpesaConversationId: conversationId } });
  if (!withdrawal) throw new WalletWithdrawalError('No withdrawal matches this payment', 'NOT_FOUND');
  if (withdrawal.status !== 'PENDING') {
    if (withdrawal.status === 'CONFIRMED' && mpesaTransactionId && !withdrawal.mpesaTransactionId) {
      return {
        withdrawal: await prisma.walletWithdrawal.update({ where: { id: withdrawal.id }, data: { mpesaTransactionId } }),
        justConfirmed: false,
      };
    }
    return { withdrawal, justConfirmed: false };
  }

  const amount = Number(withdrawal.amountKes);
  const feeKes = Number(withdrawal.feeKes);
  const netPayoutKes = Number(withdrawal.netPayoutKes);

  // Same "claim via the status column" lock confirmBusinessPayment and
  // confirmWalletTopUp both use: two paths (the result callback and a
  // console-mode confirm) could otherwise both observe PENDING at once.
  const LOST_RACE = Symbol('wallet withdrawal already confirmed');

  let updated: ConfirmWalletWithdrawalResult['withdrawal'];
  try {
    updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletWithdrawal.updateMany({
        where: { id: withdrawal.id, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), mpesaTransactionId: mpesaTransactionId || null },
      });
      if (claimed.count === 0) throw LOST_RACE;

      const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: conversationId } });
      let entryId = existingEntry?.id;
      if (!entryId) {
        const [wallet, settlement, feeIncome] = await Promise.all([
          walletAccountId(tx, withdrawal.partyId),
          settlementAccountId(tx),
          feeKes > 0 ? feeIncomeAccountId(tx) : Promise.resolve(null),
        ]);
        const entry = await tx.journalEntry.create({
          data: {
            reference: `WALLET-WITHDRAWAL-${withdrawal.id}`,
            description: 'Wallet withdrawal',
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
      return tx.walletWithdrawal.update({ where: { id: withdrawal.id }, data: { journalEntryId: entryId } });
    });
  } catch (e) {
    if (e !== LOST_RACE) throw e;
    const settled = await prisma.walletWithdrawal.findUnique({ where: { id: withdrawal.id } });
    return { withdrawal: settled!, justConfirmed: false };
  }

  await recordAudit(systemCtx('mpesa-b2c-callback'), {
    action: 'wallet.withdrawn',
    targetType: 'wallet_withdrawal',
    targetId: withdrawal.id,
    payload: { mpesaTransactionId, partyId: withdrawal.partyId, amountKes: amount, feeKes, netPayoutKes },
  });

  return { withdrawal: updated, justConfirmed: true };
}
