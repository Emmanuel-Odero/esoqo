import { getObject } from '@esoqo/db';

/**
 * Public image serving for company branding (parcel-label logos),
 * mirroring the admin's and apps/app's own /img routes. Relative
 * logoUrls ("/img/…") resolve against whichever app renders them, so
 * the public site needs this route too for a logo uploaded in admin to
 * show up on bus/company cards here.
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
