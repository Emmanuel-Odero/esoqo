'use server';

import { revalidatePath } from 'next/cache';
import { fulfilStoreOrder, confirmStoreOrderCod } from '@esoko/db';
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
  await confirmStoreOrderCod(ctx, orderId);
  revalidatePath('/dashboard/orders');
}
