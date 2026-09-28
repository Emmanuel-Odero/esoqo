import { redirect } from 'next/navigation';
import type { Route } from 'next';

/**
 * `/i/<token>` — the short invite link sent to someone an officer added
 * to a group who has no Esoqo account yet.
 *
 * A redirect and nothing else. The token is read and validated by /join
 * itself (see readInviteToken in @esoqo/auth), which is where the prefill
 * it unlocks is actually used; doing the lookup twice would only mean two
 * places that can disagree about what an expired invite does. The short
 * path exists so the URL fits an SMS — see inviteLinks.ts.
 */
export default async function InviteShortLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/join?i=${encodeURIComponent(token)}` as Route);
}
