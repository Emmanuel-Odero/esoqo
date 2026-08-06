'use server';

import { recordPosSale } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export async function syncPosSale(
  storeId: string,
  sale: {
    clientSaleId: string;
    paymentMethod: 'CASH' | 'MPESA_TILL';
    soldAt: string;
    items: { productId: string; quantity: number; unitPriceKes: number }[];
  },
) {
  const ctx = await requireSubject();
  await recordPosSale(ctx, storeId, sale);
}
