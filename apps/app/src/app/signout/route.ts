import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { destroySession, SESSION_COOKIE } from '@esoqo/auth';

/**
 * Sign out.
 *
 * POST, not GET. As a GET this was reachable by any third-party page —
 * `<img src="https://app.esoqo.co.ke/signout">` on an unrelated site
 * logged the visitor out of Esoqo, with no interaction and nothing shown
 * to them. Harmless-looking, but it is a denial of service against a
 * user mid-task (a booking, a payment), and browsers prefetch and
 * scan-ahead GETs on their own besides.
 *
 * A GET with side effects can't be defended by a token either, since the
 * whole point is that it works as a bare URL. Making it POST is the
 * fix: the callers are forms now, and a cross-origin form POST cannot
 * carry this site's cookies under SameSite=Lax.
 */
export async function POST(request: NextRequest) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // destroySession removes the Redis entry; a failure must not block
    // the browser from dropping its cookie anyway.
    await destroySession(token).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);

  // 303, not next/navigation's redirect(): that issues a 307, which
  // preserves the method — the browser would POST to /signin and get a
  // 405. 303 is the status that turns a POST into a following GET.
  return NextResponse.redirect(new URL('/signin', request.url), 303);
}

/**
 * Someone reaching /signout directly (a bookmark, a typed URL, an old
 * link) gets sent home rather than a 405 — and, crucially, is not signed
 * out by the visit itself.
 */
export async function GET() {
  redirect('/me');
}
