'use server';

import { addReceiptItems, ReceiptError } from '@esoqo/db';
import { receiptItemsSchema } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function submitReceiptItems(
  receiptId: string,
  rawItems: unknown,
): Promise<ActionResult> {
  const parsed = receiptItemsSchema.safeParse(rawItems);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check these items and try again' };

  const ctx = await requireSubject();
  try {
    await addReceiptItems(ctx, receiptId, parsed.data);
    return { ok: true };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save these items' };
  }
}
