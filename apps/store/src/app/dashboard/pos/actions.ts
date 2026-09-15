'use server';

import { recordPosSale, PosSaleError } from '@esoqo/db';
import { posSaleSchema, type PosSaleFormInput } from '@esoqo/domain';
import { requireStoreAccess } from '@/lib/session';

export async function syncPosSale(storeId: string, raw: PosSaleFormInput) {
  const parsed = posSaleSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid sale');

  const { ctx } = await requireStoreAccess();
  try {
    return await recordPosSale(ctx, storeId, parsed.data);
  } catch (e) {
    if (e instanceof PosSaleError) throw new Error(e.message);
    throw e;
  }
}
