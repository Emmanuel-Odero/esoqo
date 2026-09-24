/**
 * Generic org signout — POST /orgs/signout
 *
 * Clears the org session cookie for the current org type.
 * Works for any org type (courier, hotel, eatery, chama, tout).
 *
 * POST only — same reasoning as all other signout routes:
 * a GET would let any third-party page sign staff out mid-shift
 * via an <img> tag or prefetch.
 *
 * The org type is read from the request body or a cookie so we know
 * which session cookie to clear. Falls back to clearing all known
 * org cookies if type is unspecified.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

const ORG_SESSION_COOKIES = [
  'esoqo_parcel_org_session', // courier (legacy name)
  'esoqo_org_session',        // all other org types
] as const;

export async function POST(request: NextRequest) {
  const jar = await cookies();

  // Try to read org type from form body to clear the right cookie
  let orgType: string | null = null;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await request.json() as { orgType?: string };
      orgType = body.orgType ?? null;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const fd = await request.formData();
      orgType = (fd.get('orgType') as string | null);
    }
  } catch {
    // Ignore parse errors — clear all
  }

  if (orgType === 'courier') {
    jar.delete('esoqo_parcel_org_session');
  } else if (orgType) {
    jar.delete('esoqo_org_session');
  } else {
    // No type specified — clear both to be safe
    for (const name of ORG_SESSION_COOKIES) {
      jar.delete(name);
    }
  }

  // Also call the backend to invalidate the server-side session token
  // (best-effort — if it fails the cookie is still cleared)
  const token =
    jar.get('esoqo_parcel_org_session')?.value
    ?? jar.get('esoqo_org_session')?.value;

  if (token) {
    const goBase = process.env.CORE_GO_URL ?? 'http://localhost:8080';
    await fetch(`${goBase}/v1/orgs/me/signout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Best-effort; cookie is already cleared
    });
  }

  // Redirect to the home page after signout
  // 303 so the browser follows with GET
  return NextResponse.redirect(new URL('/', request.url), 303);
}

export async function GET() {
  return NextResponse.redirect(new URL('/', undefined), 303);
}
