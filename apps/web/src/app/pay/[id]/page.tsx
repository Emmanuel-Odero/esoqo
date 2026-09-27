import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { extractEsoqoId } from '@esoqo/domain';

/**
 * The short form of a pay link: `/pay/ESK-ABC234-KE`.
 *
 * It exists for the SMS. The full `/pay?to=ESK-ABC234-KE` is 45
 * characters on a typical host, which does not fit in a receipt message
 * once the amount and the business name are in it — and the alternative
 * of clipping the URL to make room produces a link to a business whose
 * Esoqo ID has been cut in half. Moving the ID into the path is what
 * buys the space, the same trade the parcel tracking links make with
 * `/p/<code>`.
 *
 * The printed QR still uses the full /pay form: a sticker has no length
 * budget, and the query-string form is the self-describing one.
 *
 * A redirect rather than a second page, so there is exactly one place
 * where a payee is looked up and a payment is started. This route has
 * no content of its own to keep in sync.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pay an Esoqo Business',
  // Addressed by a code rather than by anything worth indexing, and
  // /pay itself is the page a search engine should be sending people to.
  robots: { index: false, follow: true },
};

export default async function ShortPayLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const code = extractEsoqoId(decodeURIComponent(id));

  if (!code) {
    // Not an Esoqo ID. Send them somewhere that can help rather than to
    // a 404 — a sticker with a typo on it should be recoverable, and
    // /pay takes a typed code as well as a scanned one.
    redirect('/pay');
  }

  redirect(`/pay?to=${encodeURIComponent(code)}`);
}
