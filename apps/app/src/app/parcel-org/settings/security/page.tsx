import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { ChangePinPanel } from './ChangePinPanel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your sign-in and security — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * A courier-company staffer's own security page — deliberately outside
 * the manager-only team section, because the people who most need to
 * change a PIN (riders holding a temporary invite PIN) are the ones a
 * manager gate would lock out. The capability check stays server-side:
 * core-go only ever touches the session's own staff row.
 */
export default async function ParcelOrgSecurityPage() {
  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Your sign-in</h1>
          <p>
            Signed in as <strong>{me.org.name}</strong> staff. You use the same PIN at
            both doors: this portal (name + PIN) and /signin (phone + PIN).
          </p>
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 460 }}>
        <p className="sub" style={{ margin: 0 }}>
          Invited with a temporary PIN over SMS? Change it here now — pick something
          only you know. Your manager can also set a new PIN for you from the team page.
        </p>
      </div>
      <ChangePinPanel />
    </>
  );
}
