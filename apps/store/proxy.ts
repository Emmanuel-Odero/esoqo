import { NextResponse, type NextRequest } from 'next/server';

/**
 * proxy.ts — routing convenience only, NOT a security boundary.
 *
 * Rewrites `slug.esoqo.com` onto the real `/s/[slug]` route, and
 * does an optimistic redirect for the merchant dashboard/PoS. The
 * actual authorisation check happens in the Data Access Layer
 * regardless of how the request arrived here — see ADR-0003 and
 * apps/app/proxy.ts, which this mirrors.
 *
 * The other public address shape, `esoqo.com/@slug`, is NOT handled
 * here — a rewrite whose *source* path starts with `/@` reliably fails
 * to resolve in Next's App Router (a leading `@` is reserved
 * parallel-route syntax, and that reservation applies even to a
 * rewrite's incoming path, not just literal folder names). It's served
 * instead by the real file-system route at `src/app/[handle]/page.tsx`.
 */

const BASE_HOSTS = new Set(['localhost:3003', 'esoqo.com', 'www.esoqo.com']);

export function proxy(req: NextRequest) {
  if (req.headers.get('x-middleware-subrequest')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const url = req.nextUrl;
  const host = req.headers.get('host') ?? '';

  if (!BASE_HOSTS.has(host) && host.endsWith('.esoqo.com')) {
    const slug = host.split('.')[0];
    const rewritten = url.clone();
    rewritten.pathname = `/s/${slug}${url.pathname}`;
    return NextResponse.rewrite(rewritten);
  }

  const hasCookie = req.cookies.has('esoko_session');
  const gated = url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/pos');
  if (gated && !hasCookie) {
    const redirectUrl = url.clone();
    redirectUrl.pathname = '/signin';
    redirectUrl.searchParams.set('next', url.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
