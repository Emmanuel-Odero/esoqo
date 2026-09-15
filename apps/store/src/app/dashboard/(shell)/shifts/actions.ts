'use server';

import { revalidatePath } from 'next/cache';
import { getCashierPinHash, getOpenShiftForCashier, openShift, closeShift, getShiftReport } from '@esoqo/db';
import { cashierPinSchema, openShiftSchema, closeShiftSchema } from '@esoqo/domain';
import { verifyPin } from '@esoqo/auth';
import { requireSubject, requireStoreAccess } from '@/lib/session';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Verifies a cashier's PIN and reports whether they already have a
 *  shift open — the terminal uses this to decide whether to prompt for
 *  an opening float or just resume. */
export async function checkInCashier(storeId: string, raw: unknown): Promise<ActionResult<{ cashierId: string; name: string; role: string; openShiftId: string | null }>> {
  const ctx = await requireSubject();
  const parsed = cashierPinSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter your PIN' };

  try {
    const cashier = await getCashierPinHash(ctx, storeId, parsed.data.cashierId);
    const valid = await verifyPin(parsed.data.pin, cashier.pinHash);
    if (!valid) return { ok: false, error: 'Wrong PIN' };

    const open = await getOpenShiftForCashier(ctx, storeId, cashier.id);
    return { ok: true, data: { cashierId: cashier.id, name: cashier.name, role: cashier.role, openShiftId: open?.id ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not check in' };
  }
}

export async function startShift(storeId: string, raw: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const { ctx } = await requireStoreAccess();
  const parsed = openShiftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  // A cashier's own session opens only their own shift — never trust the
  // client to say whose shift this is when we already know from the
  // session who's actually signed in.
  const cashierId = ctx.actorType === 'AGENT' ? ctx.actorId! : parsed.data.cashierId;

  try {
    const shift = await openShift(ctx, storeId, cashierId, parsed.data.openingFloatKes);
    revalidatePath('/dashboard/shifts');
    return { ok: true, data: { shiftId: shift.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not open a shift' };
  }
}

export async function endShift(raw: unknown): Promise<ActionResult<Awaited<ReturnType<typeof getShiftReport>>>> {
  const { ctx } = await requireStoreAccess();
  const parsed = closeShiftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await closeShift(ctx, parsed.data.shiftId, parsed.data.countedCashKes);
    const report = await getShiftReport(ctx, parsed.data.shiftId);
    revalidatePath('/dashboard/shifts');
    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not close this shift' };
  }
}
