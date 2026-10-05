'use server';

import { revalidatePath } from 'next/cache';
import { fulfilStoreOrder, confirmStoreOrderCod } from '@esoqo/db';
import { purchaseReceiptSms } from '@esoqo/domain';
import { sendSms } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';

export async function markFulfilled(orderId: string) {
  const ctx = await requireSubject();
  await fulfilStoreOrder(ctx, orderId);
  revalidatePath('/dashboard/orders');
}

/** Cash on delivery: the merchant marks the order paid when the cash
 *  lands. Posts the sale to the ledger and flips PENDING_PAYMENT → PAID. */
export async function markCodPaid(orderId: string) {
  const ctx = await requireSubject();
  const order = await confirmStoreOrderCod(ctx, orderId);

  // Best-effort — the order is already PAID and the ledger already
  // posted, so an SMS hiccup here must not fail the merchant's action.
  if (order.receipt?.sentTo && order.receipt.receiptCode) {
    await sendSms(
      order.receipt.sentTo,
      purchaseReceiptSms({ storeName: order.receipt.storeName ?? 'Esoqo', amountKes: Number(order.receipt.totalKes), receiptCode: order.receipt.receiptCode }),
      'purchase-receipt',
    ).catch((err) => console.error(`[order ${orderId}] failed to send the receipt SMS:`, err));
  }

  revalidatePath('/dashboard/orders');
}
