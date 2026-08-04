'use server';

import { revalidatePath } from 'next/cache';
import { updateStore } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveStoreSettings(
  storeId: string,
  input: { name: string; themeKey: string; posEnabled: boolean },
): Promise<ActionResult> {
  const ctx = await requireSubject();
  if (!input.name.trim()) return { ok: false, error: 'Give your store a name' };

  try {
    await updateStore(ctx, storeId, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save changes' };
  }
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  return { ok: true };
}
