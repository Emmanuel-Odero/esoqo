import { NextResponse, type NextRequest } from 'next/server';

/**
 * proxy.ts — Next.js 16's renamed middleware.ts. NOT a security boundary
 * (see apps/app/proxy.ts for why); this one only redirects the retired
 * esoko.global domain to esoqo.com, preserving path and query string.
 */
const OLD_HOSTS = new Set(['esoko.global', 'www.esoko.global']);

export function proxy(req: NextRequest) {
  if (req.headers.get('x-middleware-subrequest')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const host = req.headers.get('host') ?? '';
  if (OLD_HOSTS.has(host)) {
    const url = req.nextUrl.clone();
    url.protocol = 'https';
    url.host = 'esoqo.com';
    url.port = '';
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
