'use server';

import { createStoreOrder, attachCheckoutRequestId, confirmStoreOrderPayment, getOrder } from '@esoko/db';
import { checkoutSchema } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A PUBLIC HTTP ENDPOINT wearing a function signature — the buyer need
 * not be signed in. Validates at the boundary with the schema the
 * client form also uses, places the order, then triggers the STK push.
 * In MPESA_PROVIDER=console the push auto-confirms, so the order is
 * already PAID by the time this returns.
 */
export async function checkout(raw: unknown): Promise<ActionResult<{ orderId: string; status: string }>> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const ctx = await getCtx();

  let order;
  try {
    order = await createStoreOrder(ctx, { ...parsed.data, paymentMethod: 'MPESA_STK' });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not place your order' };
  }

  try {
    const push = await initiateStkPush({
      msisdn: parsed.data.buyerMsisdn,
      amountKes: Number(order.totalKes),
      accountReference: `EK${order.id.slice(0, 8)}`,
      description: `Order at ${parsed.data.storeSlug}`,
    });
    await attachCheckoutRequestId(order.id, push.checkoutRequestId);
    if (push.autoConfirmed) {
      await confirmStoreOrderPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    }
  } catch (e) {
    return { ok: false, error: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment' };
  }

  const updated = await getOrder(ctx, order.id);
  return { ok: true, data: { orderId: order.id, status: updated?.status ?? 'PENDING_PAYMENT' } };
}

/** Polled by the waiting screen while a real Daraja callback is in flight. */
export async function checkOrderStatus(orderId: string): Promise<{ status: string }> {
  const ctx = await getCtx();
  const order = await getOrder(ctx, orderId);
  return { status: order?.status ?? 'PENDING_PAYMENT' };
}
