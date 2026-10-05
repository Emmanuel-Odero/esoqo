import { getDocument, getObject, recordAudit } from '@esoqo/db';
import { getCtx } from '@/lib/session';

/**
 * The capability-gated counterpart to /img/[...key] — that route is
 * deliberately public (company logos), which is fine for a logo but
 * wrong for a national ID photo. This resolves by Document id rather
 * than by opaque storage key, runs it through getDocument's own
 * document.read capability check (staff, or the document's own party),
 * and only serves the bytes — never a redirect to the raw storage key —
 * once that check passes. Every successful read is audited, same as
 * decrypting the ID number itself (see national-id.ts).
 */

const ALLOWED_KINDS = new Set(['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK']);

export async function GET(_req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const ctx = await getCtx();

  let doc;
  try {
    doc = await getDocument(ctx, documentId);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!doc || !ALLOWED_KINDS.has(doc.kind) || doc.deletedAt) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const buf = await getObject(doc.storageKey);
    await recordAudit(ctx, {
      action: 'national_id.image_viewed', targetType: 'document', targetId: doc.id,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
