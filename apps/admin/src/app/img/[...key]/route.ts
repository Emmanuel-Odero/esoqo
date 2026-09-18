import { getObject } from '@esoqo/db';

/**
 * Public image serving for company branding (parcel-label logos).
 *
 * Company logos are meant to be seen by anyone holding a printed label,
 * so this route has no auth check (same shape as store/jamii's own
 * /img routes). Storage keys stay opaque and this is the only thing
 * that resolves them to bytes, on both R2 and local-disk providers.
 * A broken/missing key is a hidden <img> upstream, never a broken
 * label — PrintableLabel hides image errors.
 */

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const storageKey = key.join('/');
  const ext = storageKey.toLowerCase().split('.').pop() ?? '';
  const mime = EXT_TO_MIME[ext];
  if (!mime) return new Response('Not found', { status: 404 });

  try {
    const buf = await getObject(storageKey);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
