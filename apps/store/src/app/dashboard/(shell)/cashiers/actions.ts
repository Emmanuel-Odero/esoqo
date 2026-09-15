'use server';

import { revalidatePath } from 'next/cache';
import { createCashier, setCashierActive } from '@esoqo/db';
import { createCashierSchema } from '@esoqo/domain';
import { hashPin, isWeakPin } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addCashier(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = createCashierSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };
  if (isWeakPin(parsed.data.pin)) return { ok: false, error: 'That PIN is too easy to guess — pick something less predictable' };

  try {
    const pinHash = await hashPin(parsed.data.pin);
    await createCashier(ctx, storeId, { name: parsed.data.name, pinHash, role: parsed.data.role });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this cashier' };
  }
  revalidatePath('/dashboard/cashiers');
  return { ok: true };
}

export async function toggleCashier(cashierId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await setCashierActive(ctx, cashierId, active);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update this cashier' };
  }
  revalidatePath('/dashboard/cashiers');
  return { ok: true };
}
