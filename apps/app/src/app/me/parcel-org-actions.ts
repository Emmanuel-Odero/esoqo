'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@esoqo/auth';
import { goUrl } from '@/lib/ticketing';
import { setParcelOrgSession } from '@/lib/parcel-org-session';

/**
 * One click from the dashboard into a company the person is staff of.
 *
 * The person's own Esoqo session (SESSION_COOKIE) is the credential;
 * core-go checks it against an active parcel_org_staff row before
 * minting the company-scoped session, so the org id here is a selector
 * over companies they already hold, not a grant. On success we plant
 * the company cookie and land in the console. The console's own
 * 401/403 handling then re-reads /v1/parcel-orgs/me — this only gets
 * them in the door.
 */
export async function enterParcelOrg(orgId: string): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/signin');

  let companyToken: string | undefined;
  try {
    const res = await fetch(goUrl('/v1/me/parcel-orgs/activate'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as { token?: string } | null;
    if (res.ok) companyToken = json?.token;
  } catch {
    // Fall through to the error redirect below.
  }

  if (!companyToken) redirect('/me?companyError=1');

  await setParcelOrgSession(companyToken);
  redirect('/parcel-org');
}
