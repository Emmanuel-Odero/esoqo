import type { TransactionFeeKind } from '@prisma/client';
import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * What a boundary-crossing transaction costs — wallet withdrawal and
 * third-party M-Pesa payout, the only two legs that actually cost Safaricom
 * money (see packages/payments' B2C integration). Everything that never
 * leaves Esoqo's own ledger — a handle-to-handle transfer, a voucher spend
 * at a business — never calls this and is free by construction.
 *
 * Banded like ParcelPricingRule's weight brackets, because Safaricom's own
 * B2C/send-money tariff is itself banded by amount: a flat fee either loses
 * money on a large payout or overcharges a small one. Data, not code — an
 * operator edits TransactionFeeBand rows when Safaricom revises its tariff,
 * same as PricingRule already is for everything else.
 */

/** No band configured for this kind/amount is not an error — it means
 *  "this transaction kind is currently free," the deliberate default for
 *  a kind nobody has priced yet. Never throws, so a missing band can't turn
 *  a withdrawal into a hard failure. */
export async function feeForAmount(kind: TransactionFeeKind, amountKes: number): Promise<number> {
  const band = await prisma.transactionFeeBand.findFirst({
    where: { kind, minKes: { lte: amountKes }, maxKes: { gte: amountKes } },
    orderBy: { minKes: 'asc' },
  });
  return band ? Number(band.feeKes) : 0;
}

export async function listFeeBands(_ctx: Ctx, kind?: TransactionFeeKind) {
  return prisma.transactionFeeBand.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ kind: 'asc' }, { minKes: 'asc' }],
  });
}

export interface UpsertFeeBandInput {
  kind: TransactionFeeKind;
  minKes: number;
  maxKes: number;
  feeKes: number;
}

/** Staff-only, same capability that already gates every other pricing
 *  edit. No unique key to upsert against (a band is identified by its
 *  bracket, not a stable id an admin form would know ahead of time), so
 *  this always inserts — replacing a band means editing/deleting the old
 *  row explicitly, not silently overwriting it by coincidence of range. */
export async function createFeeBand(ctx: Ctx, input: UpsertFeeBandInput) {
  requireCapability(ctx, 'pricing.write');
  if (!ctx.actorId) throw new Error('Fee band changes require a named staff account');
  if (input.minKes < 0 || input.maxKes < input.minKes) {
    throw new Error('minKes must be at least zero and maxKes must be at least minKes');
  }
  if (input.feeKes < 0) throw new Error('feeKes cannot be negative');

  const band = await prisma.transactionFeeBand.create({
    data: {
      kind: input.kind,
      minKes: input.minKes,
      maxKes: input.maxKes,
      feeKes: input.feeKes,
      updatedById: ctx.actorId,
    },
  });

  await recordAudit(ctx, {
    action: 'transaction_fee_band.created',
    targetType: 'transaction_fee_band',
    targetId: band.id,
    payload: { ...input },
  });

  return band;
}

export async function deleteFeeBand(ctx: Ctx, id: string) {
  requireCapability(ctx, 'pricing.write');
  const band = await prisma.transactionFeeBand.delete({ where: { id } });

  await recordAudit(ctx, {
    action: 'transaction_fee_band.deleted',
    targetType: 'transaction_fee_band',
    targetId: id,
    payload: { kind: band.kind, minKes: Number(band.minKes), maxKes: Number(band.maxKes) },
  });

  return band;
}
