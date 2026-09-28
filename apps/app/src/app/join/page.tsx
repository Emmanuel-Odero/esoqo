import type { Metadata } from 'next';
import { Logo } from '@esoqo/ui';
import { readInviteToken } from '@esoqo/auth';
import { splitFullNames } from '@esoqo/domain';
import { JoinWizard, type JoinInvite } from './JoinWizard';

export const metadata: Metadata = { title: 'Join Esoqo' };
// The invite token in `?i=` is read per request, so this can never be
// statically rendered.
export const dynamic = 'force-dynamic';

/**
 * `/join` — self-serve signup, reached two ways.
 *
 * Cold, from the marketing site or a shared link: photograph your ID and
 * the form fills itself in as far as the card allows.
 *
 * Or from a chama invite: an officer added this person to their group,
 * their name and number are already on file, and the `?i=` token (see
 * @esoqo/auth's invite.ts, and /i/<token> which redirects here) points at
 * that record. Then the page's job changes — it is finishing something
 * someone else started, and it says so, naming the group and the officer
 * so the form is recognisably the thing the text message promised.
 *
 * An expired, spent or forged token is not an error state: it degrades
 * silently to the cold flow. Somebody trying to sign up should never be
 * stopped by the failure of a convenience.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ i?: string }>;
}) {
  const { i: token } = await searchParams;
  const payload = await readInviteToken(token);
  const invite: JoinInvite | null = payload
    ? {
        token: token!,
        orgName: payload.orgName,
        inviterName: payload.inviterName,
        joinFeeKes: payload.joinFeeKes ?? 0,
        msisdn: payload.msisdn,
        email: payload.email,
        ...splitFullNames(payload.officialName ?? ''),
      }
    : null;

  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <p className="kicker">{invite ? 'You have been invited' : 'New here'}</p>
        <h1>{invite ? 'Finish joining Esoqo' : 'Join Esoqo'}</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          {invite
            ? `${invite.inviterName ?? 'An officer'} added you to ${invite.orgName}. Set up your Esoqo account and your place in the group is waiting.`
            : "Scan your national ID and we'll fill in everything we can read off it."}
        </p>
        <div style={{ marginTop: 22 }}>
          <JoinWizard invite={invite} />
        </div>
      </div>
    </div>
  );
}
