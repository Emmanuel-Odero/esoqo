import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/session';

/**
 * The app's front door (also the PWA launch URL).
 *
 * Signed-in people go straight to their record; everyone else lands on
 * the sign-in page. The /me pages re-guard themselves regardless — this
 * is convenience, not security.
 *
 * The self-serve /join registration flow is disabled for now, so
 * unsigned visitors go to /signin (which also forwards any /join link).
 */
export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const ctx = await getCtx();
  redirect(ctx.actorType === 'SUBJECT' && ctx.partyId ? '/me' : '/signin');
}