import { getObject } from '@esoqo/db';

/**
 * Public image serving for company branding (parcel-label logos),
 * mirroring the admin's own /img route. Relative logoUrls ("/img/…")
 * resolve against whichever app renders the label, and both apps read
 * the same R2 bucket in every deployed environment — so a logo
 * uploaded once in admin prints in both consoles.
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
