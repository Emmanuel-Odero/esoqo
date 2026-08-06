'use server';
import { revalidatePath } from 'next/cache';
import { signPaymentApproval, waivePayment, PaymentError } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

/**
 * Signing is a Server Action, so it is a public HTTP endpoint. Every
 * separation-of-duties rule lives in the DAL, not here — this layer
 * only authenticates and reports back.
 */
export async function actionSign(
  paymentId: string, decision: 'APPROVE' | 'REJECT', note?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await signPaymentApproval(ctx, { paymentId, decision, note });
    revalidatePath('/payments');
    return { ok: true };
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message };
    return { ok: false, error: 'Could not record that signature. Try again.' };
  }
}

export async function actionWaive(paymentId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required to waive a fee' };
    await waivePayment(ctx, paymentId, reason);
    revalidatePath('/payments');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not waive that fee' };
  }
}
