import type { Prisma } from '@prisma/client';

/**
 * Account helpers shared by every wallet-adjacent DAL module. The balance
 * check itself lives in dal/subject.ts's getWalletBalance — call that with
 * the caller's own Ctx rather than duplicating the aggregate query here;
 * every caller in this file only ever needs their own balance, which is
 * exactly what getWalletBalance(ctx) already answers.
 */

/** Finds-or-creates a party's WALLET/KES account — same helper shape as
 *  wallet-topup.ts's private walletAccountId, made shared so
 *  wallet-withdrawal.ts and esoqo-transfer.ts don't each re-implement it. */
export async function walletAccountId(tx: Prisma.TransactionClient, partyId: string): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId, kind: 'WALLET', currency: 'KES' } });
  if (existing) return existing.id;
  const created = await tx.account.create({ data: { partyId, kind: 'WALLET', currency: 'KES' } });
  return created.id;
}

export async function settlementAccountId(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  if (existing) return existing.id;
  const created = await tx.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  return created.id;
}

export async function feeIncomeAccountId(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'FEE_INCOME', currency: 'KES' } });
  if (existing) return existing.id;
  const created = await tx.account.create({ data: { partyId: null, kind: 'FEE_INCOME', currency: 'KES' } });
  return created.id;
}

export async function businessRevenueAccountId(tx: Prisma.TransactionClient, payeePartyId: string): Promise<string> {
  const existing = await tx.account.findFirst({
    where: { partyId: payeePartyId, kind: 'BUSINESS_REVENUE', currency: 'KES' },
  });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { partyId: payeePartyId, kind: 'BUSINESS_REVENUE', currency: 'KES' },
  });
  return created.id;
}
