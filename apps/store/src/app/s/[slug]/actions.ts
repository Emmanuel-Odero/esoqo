'use server';

import {
  createStoreOrder, attachCheckoutRequestId, confirmStoreOrderPayment, getOrder,
} from '@esoko/db';
import { checkoutSchema } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A PUBLIC HTTP ENDPOINT wearing a function signature — the buyer need
 * not be signed in. Validates at the boundary with the schema the
 * client form also uses, then places the order.
 *
 * Payment branches on checkoutSchema.paymentMethod:
 *  - MPESA_STK: place the order, trigger the STK push. In console mode
 *    the push auto-confirms, so the order is already PAID on return.
 *  - CASH_ON_DELIVERY: no push — the order waits at PENDING_PAYMENT and
 *    the merchant confirms payment when the cash is collected.
 */
export async function checkout(raw: unknown): Promise<ActionResult<{ orderId: string; status: string }>> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const ctx = await getCtx();

  let order;
  try {
    order = await createStoreOrder(ctx, {
      storeSlug: parsed.data.storeSlug,
      buyerName: parsed.data.buyerName,
      buyerMsisdn: parsed.data.buyerMsisdn,
      paymentMethod: parsed.data.paymentMethod,
      items: parsed.data.items,
      deliveryOptionId: parsed.data.deliveryOptionId,
      collectionNotes: parsed.data.collectionNotes,
      deliveryAddress: parsed.data.deliveryAddress,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not place your order' };
  }

  // Cash on delivery stops here — the buyer owes at the door.
  if (parsed.data.paymentMethod === 'CASH_ON_DELIVERY') {
    return { ok: true, data: { orderId: order.id, status: 'PENDING_PAYMENT' } };
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
