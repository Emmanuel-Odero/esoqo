'use server';

import { revalidatePath } from 'next/cache';
import { fulfilStoreOrder } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export async function markFulfilled(orderId: string) {
  const ctx = await requireSubject();
  await fulfilStoreOrder(ctx, orderId);
  revalidatePath('/dashboard/orders');
}
