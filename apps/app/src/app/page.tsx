import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/session';

/**
 * The app's front door (also the PWA launch URL).
 *
 * Signed-in people go straight to their record; everyone else lands on
 * the join portal. The /me pages re-guard themselves regardless —
 * this is convenience, not security.
 */
export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const ctx = await getCtx();
  redirect(ctx.actorType === 'SUBJECT' && ctx.partyId ? '/me' : '/join');
}