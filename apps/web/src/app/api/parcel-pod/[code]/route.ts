import { NextResponse } from 'next/server';

/**
 * Proxies a parcel's proof-of-delivery photo from core-go so a browser
 * can render it in an <img>.
 *
 * A proxy rather than a direct link for two reasons. CORE_GO_API_URL is
 * an internal service address in every deployed environment (see
 * parcels/actions.ts), so a browser can't reach it at all. And the
 * photo must never be served from the object store directly — a bucket
 * URL would make delivery photos, which are pictures of people's
 * doorways, publicly enumerable. Authorisation stays where it belongs:
 * core-go checks the tracking code, exactly as it does for /status.
 *
 * Nothing here is cached at the edge. `private` keeps a shared cache
 * (a corporate proxy, a CDN) from holding one person's delivery photo
 * and handing it to the next request for the same path.
 */

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const upstream = await fetch(
      `${CORE_GO_URL}/v1/parcels/${encodeURIComponent(code)}/pod-photo`,
      { cache: 'no-store', signal: AbortSignal.timeout(15000) },
    );
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    // Only ever hand a browser an image content type. core-go already
    // re-sniffs the stored bytes on read, so a non-image here means
    // something is wrong upstream, not that we should pass it through.
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Unavailable' }, { status: 502 });
  }
}
