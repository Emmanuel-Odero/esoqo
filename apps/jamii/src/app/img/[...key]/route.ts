import { getObject } from '@esoko/db';

/**
 * Public image serving — logos, cover photos and gallery images are
 * meant to be seen by anyone browsing a page, so this route has no
 * auth check. It still never serves raw off a bucket domain: storageKey
 * stays opaque and this is the only thing that resolves it to bytes, on
 * both the R2 and local-disk storage providers alike. Direct copy of
 * apps/store's /img route.
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
