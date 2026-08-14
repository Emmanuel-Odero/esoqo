import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';

/**
 * Shifts — one open/close of the register, and the Z-report that comes
 * out of closing one. The till doesn't know what SHOULD be in the
 * drawer; it can only tell you what cash sales say should be there
 * (opening float + cash sales − cash refunds). The cashier counts the
 * real drawer; the gap between the two is the variance a manager
 * actually needs to see.
 */

export class ShiftError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'ALREADY_OPEN' | 'ALREADY_CLOSED' | 'WRONG_STORE' | 'WRONG_CASHIER') {
    super(msg);
    this.name = 'ShiftError';
  }
}

/** A cashier's own session may only touch their own shift — a colleague
 *  signed in at the same store must not be able to open or close
 *  someone else's till. The owner (a SUBJECT ctx) isn't scoped this
 *  way, since they legitimately manage every cashier's shift. */
function assertOwnShiftIfAgent(ctx: Ctx, cashierId: string) {
  if (ctx.actorType === 'AGENT' && ctx.actorId !== cashierId) {
    throw new ShiftError("That's not your shift", 'WRONG_CASHIER');
  }
}

export async function openShift(ctx: Ctx, storeId: string, cashierId: string, openingFloatKes = 0) {
  await assertOwnsStore(ctx, storeId, 'shift.write');
  assertOwnShiftIfAgent(ctx, cashierId);

  const cashier = await prisma.cashier.findUnique({ where: { id: cashierId } });
  if (!cashier || cashier.storeId !== storeId) throw new ShiftError('Cashier not found', 'WRONG_STORE');

  const open = await prisma.shift.findFirst({ where: { cashierId, status: 'OPEN' } });
  if (open) throw new ShiftError('This cashier already has an open shift', 'ALREADY_OPEN');

  const shift = await prisma.shift.create({ data: { storeId, cashierId, openingFloatKes } });
  await recordAudit(ctx, { action: 'shift.opened', targetType: 'shift', targetId: shift.id, payload: { storeId, cashierId, openingFloatKes } });
  return shift;
}

/** Cash sales minus cash refunds in this shift, plus the float it opened
 *  with — what the drawer SHOULD hold if every cash transaction is
 *  accounted for. */
async function expectedCashFor(shiftId: string, openingFloatKes: number) {
  const [sales, refunds] = await Promise.all([
    prisma.posSale.aggregate({ where: { shiftId, paymentMethod: 'CASH', status: 'COMPLETED' }, _sum: { totalKes: true } }),
    prisma.posRefund.findMany({ where: { sale: { shiftId }, refundMethod: 'CASH' }, select: { amountKes: true } }),
  ]);
  const cashSalesKes = Number(sales._sum.totalKes ?? 0);
  const cashRefundsKes = refunds.reduce((n, r) => n + Number(r.amountKes), 0);
  return Math.round((openingFloatKes + cashSalesKes - cashRefundsKes) * 100) / 100;
}

export async function closeShift(ctx: Ctx, shiftId: string, countedCashKes: number) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new ShiftError('Shift not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, shift.storeId, 'shift.write');
  assertOwnShiftIfAgent(ctx, shift.cashierId);
  if (shift.status === 'CLOSED') throw new ShiftError('This shift is already closed', 'ALREADY_CLOSED');

  const expectedCashKes = await expectedCashFor(shiftId, Number(shift.openingFloatKes));
  const varianceKes = Math.round((countedCashKes - expectedCashKes) * 100) / 100;

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: { status: 'CLOSED', closedAt: new Date(), expectedCashKes, countedCashKes, varianceKes },
  });
  await recordAudit(ctx, {
    action: 'shift.closed', targetType: 'shift', targetId: shiftId,
    payload: { expectedCashKes, countedCashKes, varianceKes },
  });
  return updated;
}

export async function listShifts(ctx: Ctx, storeId: string, take = 30) {
  await assertOwnsStore(ctx, storeId, 'shift.write');
  return prisma.shift.findMany({
    where: { storeId },
    include: { cashier: { select: { id: true, name: true } } },
    orderBy: { openedAt: 'desc' },
    take,
  });
}

/** The active shift for a given cashier, if any — what the terminal
 *  checks on load to resume where a cashier left off. */
export async function getOpenShiftForCashier(ctx: Ctx, storeId: string, cashierId: string) {
  await assertOwnsStore(ctx, storeId, 'pos.sell');
  return prisma.shift.findFirst({ where: { storeId, cashierId, status: 'OPEN' } });
}

/** The Z-report — a shift's full accounting, open or closed. Cash
 *  reconciliation only means something once it's closed (countedCashKes
 *  is null until then); everything else is live. */
export async function getShiftReport(ctx: Ctx, shiftId: string) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { cashier: true } });
  if (!shift) throw new ShiftError('Shift not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, shift.storeId, 'shift.write');

  const sales = await prisma.posSale.findMany({
    where: { shiftId, status: 'COMPLETED' },
    include: { refunds: true },
  });

  const byMethod = new Map<string, { count: number; totalKes: number }>();
  for (const s of sales) {
    const cur = byMethod.get(s.paymentMethod) ?? { count: 0, totalKes: 0 };
    cur.count += 1;
    cur.totalKes += Number(s.totalKes);
    byMethod.set(s.paymentMethod, cur);
  }
  const paymentSplit = [...byMethod.entries()].map(([method, v]) => ({ method, ...v }));

  const totalSalesKes = sales.reduce((n, s) => n + Number(s.totalKes), 0);
  const refunds = sales.flatMap((s) => s.refunds);
  const totalRefundsKes = refunds.reduce((n, r) => n + Number(r.amountKes), 0);

  const expectedCashKes = shift.status === 'CLOSED'
    ? Number(shift.expectedCashKes ?? 0)
    : await expectedCashFor(shiftId, Number(shift.openingFloatKes));

  return {
    shift,
    saleCount: sales.length,
    totalSalesKes,
    totalRefundsKes,
    paymentSplit,
    openingFloatKes: Number(shift.openingFloatKes),
    expectedCashKes,
    countedCashKes: shift.countedCashKes !== null ? Number(shift.countedCashKes) : null,
    varianceKes: shift.varianceKes !== null ? Number(shift.varianceKes) : null,
  };
}
