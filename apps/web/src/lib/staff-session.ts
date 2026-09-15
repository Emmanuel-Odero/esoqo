import { cookies } from 'next/headers';

/**
 * A parcel-company staffer's own session, held on this otherwise fully
 * guest, no-auth site — see send-parcel/actions.ts's own comment on why
 * that file never reads a cookie. This is deliberately a separate,
 * narrow addition: the public tracking page gained a "staff? sign in to
 * scan" panel (see track/StaffPanel.tsx), and a typed Esoqo ID alone is
 * never enough to authorize anything — only a real PIN sign-in against
 * core-go's existing /v1/parcel-orgs/staff/signin is. Same bearer-token
 * shape apps/app's own parcel-org-session.ts already uses; duplicated
 * rather than imported because these are two separate Next apps with
 * no shared runtime, only a shared backend contract.
 */

const STAFF_SESSION_COOKIE = 'esoqo_track_staff_session';
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export class StaffUnauthorised extends Error {}

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

export async function setStaffToken(token: string): Promise<void> {
  (await cookies()).set(STAFF_SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    // 12 hours — a shift, matching the TTL core-go actually issues the
    // token for (see handleParcelStaffSignIn). Outliving the token
    // itself would just mean an extra request that 401s.
    maxAge: 12 * 60 * 60,
  });
}

export async function clearStaffToken(): Promise<void> {
  (await cookies()).delete(STAFF_SESSION_COOKIE);
}

export async function staffToken(): Promise<string | null> {
  return (await cookies()).get(STAFF_SESSION_COOKIE)?.value ?? null;
}

/** Fetch against core-go with the staff bearer attached, or throw
 *  StaffUnauthorised if there is none / it's been rejected — same
 *  contract apps/app's parcelOrgFetch follows. */
export async function staffFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await staffToken();
  if (!token) throw new StaffUnauthorised('Not signed in');
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (res.status === 401 || res.status === 403) {
    throw new StaffUnauthorised(json?.error?.message ?? 'Sign in again');
  }
  if (!res.ok || !json) {
    throw new Error(json?.error?.message ?? 'That did not work');
  }
  return json as T;
}
