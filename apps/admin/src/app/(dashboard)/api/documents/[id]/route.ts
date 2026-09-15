import { NextResponse, type NextRequest } from 'next/server';
import { getDocument, getObject } from '@esoqo/db';
import { getCtx } from '@/lib/session';

/**
 * Authorised file serving.
 *
 * Files are NEVER static assets. Every request re-authorises through the
 * DAL, and the response carries Content-Disposition plus nosniff so a
 * crafted upload cannot execute in the app origin.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getCtx();
  const { id } = await params;

  const doc = await getDocument(ctx, id).catch(() => null);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getObject(doc.storageKey);
  } catch {
    return new NextResponse('File missing from storage', { status: 410 });
  }

  const inline = req.nextUrl.searchParams.get('inline') === '1'
    && (doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('image/'));

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Length': String(bytes.length),
      'Content-Disposition':
        `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.originalName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
