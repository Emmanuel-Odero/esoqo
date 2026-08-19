import { NextResponse, type NextRequest } from 'next/server';
// Narrower than `@esoko/db` on purpose — that barrel also re-exports
// storage.ts (S3/fs), which drags filesystem code into the middleware
// bundle and breaks it. The DAL barrel alone is everything
// ADR-0003 requires and nothing storage-related.
import { resolveJamiiDomain } from '@esoko/db/dal';

/**
 * Host-based routing for custom domains — see the "Clean URLs" section
 * of the custom-domains proposal. Runs on every request; anything on
 * this app's own primary host(s) passes straight through untouched.
 * A Host this app doesn't recognise is looked up against verified,
 * ACTIVE JamiiDomains only (resolveJamiiDomain never returns a pending,
 * suspended or removed one) and, if found, rewritten from whatever
 * clean path the visitor requested (e.g. /about) to /o/{slug}/about —
 * transparent to the browser, so the address bar keeps the group's own
 * domain the whole time.
 *
 * `runtime: 'nodejs'` (not the default edge runtime) so this can query
 * Postgres directly, the same as every Server Component/Action in this
 * app already does — see ADR-0003's DAL-only-access rule, which this
 * still honours: resolveJamiiDomain is the DAL function, nothing here
 * touches Prisma directly.
 */
export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/|_next\\.|favicon\\.ico|img/|api/).*)'],
};

function primaryHosts(): string[] {
  const configured = process.env.JAMII_PRIMARY_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
  return configured?.length ? configured : ['ourjamii.co.ke', 'localhost', '127.0.0.1'];
}

/**
 * Tiny in-process cache so a burst of requests to the same custom
 * domain doesn't hit Postgres per request — domains change status
 * rarely enough that a short TTL is plenty, and a stale ACTIVE->
 * SUSPENDED transition is caught within the TTL window regardless.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: { pageId: string; slug: string } | null; expiresAt: number }>();

async function lookupDomain(hostname: string) {
  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await resolveJamiiDomain(hostname);
  cache.set(hostname, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export default async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];

  // Always strip any inbound x-jamii-domain-slug first — it's an
  // internal signal middleware sets for the app to trust, not something
  // a client should ever be able to hand us directly.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-jamii-domain-slug');

  if (!host || primaryHosts().includes(host)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const resolved = await lookupDomain(host);
  if (!resolved) {
    // Deliberately generic — an unmatched hostname could be pending,
    // suspended, or never claimed at all, and the response shouldn't
    // let a probe tell those apart.
    return new NextResponse('This domain isn’t configured for Our Jamii.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = `/o/${resolved.slug}${req.nextUrl.pathname}`;

  // Set as a *request* header (not a response header) so headers()
  // inside Server Components — getOrgLinkMode() — can read it; that's
  // what keeps links root-relative to the custom domain instead of
  // re-adding /o/{slug}.
  requestHeaders.set('x-jamii-domain-slug', resolved.slug);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}
