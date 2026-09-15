import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/session';

/**
 * Proxies a parcel's proof-of-delivery photo from core-go so the admin
 * console can render it in an <img>.
 *
 * Staff-gated, unlike the public web app's equivalent. Both exist for
 * the same underlying reason — CORE_GO_API_URL is an internal service
 * address a browser can't reach, and the photo must never be served
 * from the object store directly, because a bucket URL would make
 * pictures of people's doorways publicly enumerable. But the two have
 * different audiences: the public one is reached by whoever holds the
 * tracking code (the sender and the receiver), while an operator here
 * is looking at a parcel that isn't theirs, so it gets the same
 * requireStaff check every other admin surface has.
 *
 * `private` on the cache header keeps a shared cache (a corporate
 * proxy, a CDN) from holding one parcel's photo and serving it to the
 * next request for the same path.
 */

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  await requireStaff();
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
    // Only ever hand a browser an image content type. core-go re-sniffs
    // the stored bytes on read, so a non-image here means something is
    // wrong upstream, not that it should be passed through.
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
