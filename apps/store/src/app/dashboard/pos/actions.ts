'use server';

import { recordPosSale, PosSaleError } from '@esoqo/db';
import { posSaleSchema, type PosSaleFormInput } from '@esoqo/domain';
import { purchaseReceiptSms } from '@esoqo/domain';
import { sendSms } from '@esoqo/auth';
import { requireStoreAccess } from '@/lib/session';

export async function syncPosSale(storeId: string, raw: PosSaleFormInput) {
  const parsed = posSaleSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid sale');

  const { ctx } = await requireStoreAccess();
  let result;
  try {
    result = await recordPosSale(ctx, storeId, parsed.data);
  } catch (e) {
    if (e instanceof PosSaleError) throw new Error(e.message);
    throw e;
  }

  // Best-effort, same as every other automatic receipt send: the sale is
  // already recorded and the ledger already posted by this point, so an
  // SMS provider hiccup must not fail the sale.
  const receipt = 'receipt' in result ? result.receipt : undefined;
  if (receipt?.sentTo && receipt.receiptCode) {
    await sendSms(
      receipt.sentTo,
      purchaseReceiptSms({ storeName: receipt.storeName ?? 'Esoqo', amountKes: Number(receipt.totalKes), receiptCode: receipt.receiptCode }),
      'purchase-receipt',
    ).catch((err) => console.error(`[pos ${storeId}] failed to send the receipt SMS:`, err));
  }

  return result;
}
