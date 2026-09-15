import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { clearParcelOrgSession } from '@/lib/parcel-org-session';

/**
 * Sign out — POST only, same reasoning as the org-staff and subject
 * signout routes: as a GET, any third-party page could sign a rider out
 * of a shared depot phone mid-shift with a single image tag.
 */
export async function POST(request: NextRequest) {
  await clearParcelOrgSession();
  // 303 so the browser follows with a GET — a 307 would replay the POST
  // against the target.
  return NextResponse.redirect(new URL('/parcel-org/signed-out', request.url), 303);
}

/** A direct visit lands on the explainer rather than silently ending
 *  the session. */
export async function GET() {
  redirect('/parcel-org/signed-out');
}
