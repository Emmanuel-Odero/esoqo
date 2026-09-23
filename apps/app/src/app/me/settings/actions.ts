'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { setDisplayPrefs, erasePartyData, type DisplayPrefs } from '@esoqo/db';
import { destroySession, SESSION_COOKIE } from '@esoqo/auth';
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

/**
 * DPA s.35 — right to erasure. The subject requests deletion of their
 * own record. `erasePartyData` soft-deletes and scrubs direct
 * identifiers while preserving the audit chain (the chain is a legal
 * record; breaking it would be the worse failure). After erasure the
 * session is cleared and the user is redirected to the public site.
 *
 * Staff-initiated erasure (for requests received by email or USSD) lives
 * in apps/admin — see RegistrationTable's erase panel.
 */
export async function actionEraseMyData(reason: string) {
  let partyId: string;
  try {
    const ctx = await requireSubject();
    partyId = ctx.partyId!;
    await erasePartyData(ctx, partyId, reason || 'Subject self-requested via account settings');
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) await destroySession(token).catch(() => {});
    jar.delete(SESSION_COOKIE);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not complete erasure' };
  }
  // Redirect outside the try/catch — Next.js redirect() throws internally.
  redirect('https://esoqo.co.ke/?erased=1');
}
