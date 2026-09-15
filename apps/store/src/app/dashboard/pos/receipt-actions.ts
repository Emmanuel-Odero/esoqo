'use server';

import { issueReceipt, ReceiptError } from '@esoqo/db';
import { sendSms } from '@esoqo/auth';
import { saleReceiptSms } from '@esoqo/domain';
import { requireStoreAccess } from '@/lib/session';

export type ActionResult = { ok: true; receiptId: string } | { ok: false; error: string };

/**
 * Issues a receipt and, for an SMS copy, actually sends it. The DAL only
 * writes the Receipt row — @esoqo/db can't depend on @esoqo/auth (which
 * depends back on it), so the send itself happens here, the one place
 * that already has both.
 */
export async function issueSaleReceipt(
  storeId: string,
  input: { saleId: string; channel: 'PRINT' | 'SMS'; sentTo?: string },
): Promise<ActionResult> {
  const { ctx } = await requireStoreAccess();
  try {
    const receipt = await issueReceipt(ctx, storeId, input);

    if (input.channel === 'SMS' && input.sentTo) {
      const message = saleReceiptSms({
        storeName: receipt.storeName,
        receiptNo: receipt.receiptNo,
        totalKes: Number(receipt.totalKes),
        etimsSerial: receipt.etimsSerial,
      });
      await sendSms(input.sentTo, message, 'sale-receipt');
    }

    return { ok: true, receiptId: receipt.id };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Could not issue this receipt' };
  }
}
