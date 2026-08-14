'use server';

import { issueReceipt, ReceiptError } from '@esoko/db';
import { sendSms } from '@esoko/auth';
import { requireStoreAccess } from '@/lib/session';

export type ActionResult = { ok: true; receiptId: string } | { ok: false; error: string };

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

/**
 * Issues a receipt and, for an SMS copy, actually sends it. The DAL only
 * writes the Receipt row — @esoko/db can't depend on @esoko/auth (which
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
      const message = `Receipt ${receipt.receiptNo} — ${kes(Number(receipt.totalKes))}${receipt.etimsSerial ? ` — eTIMS ${receipt.etimsSerial}` : ''}. Thank you for shopping with us.`;
      await sendSms(input.sentTo, message);
    }

    return { ok: true, receiptId: receipt.id };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Could not issue this receipt' };
  }
}
