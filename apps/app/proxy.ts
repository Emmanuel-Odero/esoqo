import { NextResponse, type NextRequest } from 'next/server';

/**
 * proxy.ts — renamed from middleware.ts in Next.js 16.
 *
 * WARNING: THIS IS NOT A SECURITY BOUNDARY.
 *
 * It performs optimistic redirects so an unauthenticated visitor is not
 * shown a spinner before being bounced. That is all it does. Every actual
 * authorisation decision happens in the Data Access Layer, backed by
 * Postgres row-level security.
 *
 * Why so emphatic: CVE-2025-29927 (CVSS 9.1) allowed complete bypass of
 * Next.js middleware via the x-middleware-subrequest header, and the
 * July 2026 advisory set included a further middleware/proxy bypass in
 * App Router applications. Any app that treated this file as the gate
 * was wide open. Ours is not. See ADR-0003.
 */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // Belt and braces — the CDN also strips this.
  if (req.headers.get('x-middleware-subrequest')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const hasCookie = req.cookies.has('esoko_session');
  const p = req.nextUrl.pathname;

  if (p.startsWith('/me') && !hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', p);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
