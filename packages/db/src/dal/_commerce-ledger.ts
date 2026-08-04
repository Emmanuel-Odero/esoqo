import { prisma } from '../client';
import { systemCtx } from '../capabilities';
import { recordAudit } from '../audit';
import type { Prisma } from '@prisma/client';

/**
 * Interim TypeScript posting of store/PoS money into the existing
 * Account/JournalEntry/Posting tables.
 *
 * This is NOT services/ledger — that Rust service is Phase 2 and
 * explicitly not AI-owned (see services/ledger/README.md). This module
 * is the placeholder that keeps every sale double-entry and idempotent
 * in the meantime; the account-lookup below is not safe under heavy
 * concurrent write load (a genuine race can create two SETTLEMENT or
 * FEE_INCOME rows), which is exactly the class of bug the real ledger
 * service exists to close out under serialisable isolation.
 */

const PLATFORM_FEE_KEY = 'PLATFORM_FEE_PCT';

async function findOrCreateAccount(
  tx: Prisma.TransactionClient,
  partyId: string | null,
  kind: 'STORE_REVENUE' | 'FEE_INCOME' | 'SETTLEMENT',
) {
  const existing = await tx.account.findFirst({ where: { partyId, kind, currency: 'KES' } });
  if (existing) return existing;
  return tx.account.create({ data: { partyId, kind, currency: 'KES' } });
}

export interface PostStoreSaleInput {
  storeOwnerPartyId: string;
  totalKes: number;
  reference: string;
  description: string;
  /** M-Pesa's CheckoutRequestID/receipt, or the PoS clientSaleId. */
  idempotencyKey: string;
}

/**
 * Posts a confirmed sale: money in, split between the merchant's
 * STORE_REVENUE account and the platform's FEE_INCOME cut (from the
 * live PLATFORM_FEE_PCT PricingRule). Idempotent — a JournalEntry with
 * this idempotencyKey already existing means the sale was already
 * posted, so a retried M-Pesa callback or a re-synced PoS sale can
 * never double-credit anyone.
 */
export async function postStoreSale(input: PostStoreSaleInput) {
  const existing = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const feeRule = await prisma.pricingRule.findUnique({ where: { key: PLATFORM_FEE_KEY } });
  const feePct = feeRule?.amountPct ? Number(feeRule.amountPct) : 0;
  const fee = Math.round(input.totalKes * (feePct / 100) * 100) / 100;
  const netToMerchant = input.totalKes - fee;

  return prisma.$transaction(async (tx) => {
    const settlement = await findOrCreateAccount(tx, null, 'SETTLEMENT');
    const revenue = await findOrCreateAccount(tx, input.storeOwnerPartyId, 'STORE_REVENUE');

    const postings: Prisma.PostingCreateWithoutEntryInput[] = [
      { account: { connect: { id: settlement.id } }, amount: input.totalKes },
      { account: { connect: { id: revenue.id } }, amount: -netToMerchant },
    ];
    if (fee > 0) {
      const feeIncome = await findOrCreateAccount(tx, null, 'FEE_INCOME');
      postings.push({ account: { connect: { id: feeIncome.id } }, amount: -fee });
    }

    const entry = await tx.journalEntry.create({
      data: {
        reference: input.reference,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        postings: { create: postings },
      },
    });

    await recordAudit(
      systemCtx('commerce-ledger'),
      {
        action: 'commerce.sale.posted',
        targetType: 'journal_entry',
        targetId: entry.id,
        payload: { totalKes: input.totalKes, fee, reference: input.reference },
      },
      tx as never,
    );

    return entry;
  });
}
