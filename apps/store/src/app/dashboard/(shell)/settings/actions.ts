'use server';

import { revalidatePath } from 'next/cache';
import { updateStore, createFulfilmentOption, setFulfilmentOptionActive } from '@esoqo/db';
import { fulfilmentOptionSchema } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveStoreSettings(
  storeId: string,
  input: {
    name: string; themeKey: string; posEnabled: boolean;
    etimsEnabled?: boolean; loyaltyEnabled?: boolean; loyaltyPerKes?: number;
  },
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

export async function addFulfilmentOption(storeId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = fulfilmentOptionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again' };

  try {
    await createFulfilmentOption(ctx, storeId, parsed.data);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add this option' };
  }
  revalidatePath('/dashboard/settings');
  return { ok: true };
}

export async function toggleFulfilmentOption(optionId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await setFulfilmentOptionActive(ctx, optionId, active);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update this option' };
  }
  revalidatePath('/dashboard/settings');
  return { ok: true };
}
