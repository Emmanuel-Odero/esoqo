import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { goUrl } from './ticketing';

/**
 * The courier companies the signed-in person is staff of — core-go's
 * GET /v1/me/parcel-orgs.
 *
 * The subject-session counterpart to the portal's own
 * parcelOrgFetch (see parcel-org-session.ts): that one carries the
 * company-scoped cookie and talks as the company, this one carries the
 * person's own Esoqo bearer and asks only "which companies am I on the
 * books of". They are deliberately different credentials — being signed
 * in as yourself must not by itself grant anything inside a company.
 */
export interface MyParcelOrg {
  orgId: string;
  name: string;
  slug: string;
  status: string;
  role: string;
}

interface MyParcelOrgsResponse {
  orgs: MyParcelOrg[] | null;
}

/**
 * Best-effort: a dashboard that fails to render because one optional
 * card's backend call failed would be worse than a dashboard with no
 * company card. Returns [] on any error, exactly like the app's other
 * optional dashboard reads.
 */
export async function getMyParcelOrgs(): Promise<MyParcelOrg[]> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return [];
  try {
    const res = await fetch(goUrl('/v1/me/parcel-orgs'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as MyParcelOrgsResponse | null;
    return json?.orgs ?? [];
  } catch {
    return [];
  }
}
