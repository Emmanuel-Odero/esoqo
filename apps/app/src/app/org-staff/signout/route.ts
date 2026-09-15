import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { destroyTicketStaffSession } from '@/lib/session';

/**
 * Sign out — POST only, same reasoning as the subject /signout route:
 * as a GET, any third-party page could sign a gate attendant out of a
 * shared device mid-shift with a single image tag.
 */
export async function POST(request: NextRequest) {
  await destroyTicketStaffSession();
  // 303 so the browser follows with a GET — a 307 would replay the POST
  // against the target.
  return NextResponse.redirect(new URL('/', request.url), 303);
}

/** A direct visit goes home rather than silently ending the session. */
export async function GET() {
  redirect('/');
}
