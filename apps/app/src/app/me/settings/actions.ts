'use server';
import { revalidatePath } from 'next/cache';
import { setDisplayPrefs, type DisplayPrefs } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export async function actionSetPrefs(prefs: DisplayPrefs) {
  try {
    const ctx = await requireSubject();
    const saved = await setDisplayPrefs(ctx, prefs);
    revalidatePath('/me', 'layout');
    return { ok: true as const, prefs: saved };
  } catch {
    return { ok: false as const, error: 'Could not save that' };
  }
}
