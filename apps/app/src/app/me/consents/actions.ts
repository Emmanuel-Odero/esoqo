'use server';
import { revalidatePath } from 'next/cache';
import { revokeConsent } from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

/** Never blocked, never questioned. The DPA makes this a right. */
export async function actionRevoke(grantId: string) {
  try {
    const ctx = await requireSubject();
    await revokeConsent(ctx, grantId, 'WEB');
    revalidatePath('/me/consents');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, "That permission couldn't be ended. Please try again — if it keeps happening, dial *483*77# and choose 7.") };
  }
}
