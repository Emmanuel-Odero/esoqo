'use server';

import { revalidatePath } from 'next/cache';
import { recordCustomerPayment, adjustCustomerBalance, updateCustomer } from '@esoko/db';
import { customerPaymentSchema, customerAdjustmentSchema, customerEditSchema } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function payDownBalance(customerId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = customerPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await recordCustomerPayment(ctx, customerId, parsed.data.amountKes, parsed.data.note || undefined);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not record this payment' };
  }
  revalidatePath(`/dashboard/customers/${customerId}`);
  revalidatePath('/dashboard/customers');
  revalidatePath('/dashboard/debts');
  return { ok: true };
}

export async function adjustBalance(customerId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = customerAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await adjustCustomerBalance(ctx, customerId, parsed.data.amountKes, parsed.data.note);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not adjust this balance' };
  }
  revalidatePath(`/dashboard/customers/${customerId}`);
  revalidatePath('/dashboard/customers');
  revalidatePath('/dashboard/debts');
  return { ok: true };
}

export async function editCustomer(customerId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = customerEditSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await updateCustomer(ctx, customerId, { name: parsed.data.name || null, notes: parsed.data.notes || null });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save this customer' };
  }
  revalidatePath(`/dashboard/customers/${customerId}`);
  revalidatePath('/dashboard/customers');
  revalidatePath('/dashboard/debts');
  return { ok: true };
}
