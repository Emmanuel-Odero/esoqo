import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { clearParcelOrgSession, parcelOrgToken } from '@/lib/parcel-org-session';
import { goUrl } from '@/lib/ticketing';

/**
 * Sign out — POST only, same reasoning as the org-staff and subject
 * signout routes: as a GET, any third-party page could sign a rider out
 * of a shared depot phone mid-shift with a single image tag.
 *
 * Read the token before clearing the cookie, and revoke it server-side:
 * without this, a courier session copied off a shared depot phone (its
 * entire threat model) stayed valid for its full 12h TTL after the
 * rider "signed out" — clearing the cookie alone only logged out the
 * browser, not the token.
 */
export async function POST(request: NextRequest) {
  const token = await parcelOrgToken();
  await clearParcelOrgSession();

  if (token) {
    await fetch(goUrl('/v1/orgs/me/signout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Best-effort; cookie is already cleared
    });
  }

  // 303 so the browser follows with a GET — a 307 would replay the POST
  // against the target.
  return NextResponse.redirect(new URL('/parcel-org/signed-out', request.url), 303);
}

/** A direct visit lands on the explainer rather than silently ending
 *  the session. */
export async function GET() {
  redirect('/parcel-org/signed-out');
}
