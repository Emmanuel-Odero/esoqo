import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { isTransactionCodeShape } from '@esoqo/domain';
import { VerifyForm } from '../VerifyForm';

export const metadata: Metadata = {
  // Neutral, not "Verify a receipt": this route is the destination for
  // any code someone was texted or handed, and a certificate code pasted
  // into the same link is a legitimate visit. No generateMetadata from
  // the URL segment either — that would let any URL mint an arbitrary
  // page title, which is a spam surface rather than a feature.
  title: 'Verify a code',
  description: 'Check any Esoqo receipt or certificate. No account needed.',
};

/**
 * Where the SMS link in purchaseReceiptSms/payerPaymentReceiptSms
 * actually lands — same VerifyForm the plain /verify page renders, just
 * given the code from the URL so it checks itself on load instead of
 * waiting for someone to type it in.
 *
 * The URL segment is untrusted input on a public, unauthenticated page,
 * so it is neither trusted to be valid percent-encoding nor trusted to
 * be a code at all. `decodeURIComponent('%ZZ')` throws a URIError, and
 * an uncaught throw in a server component is a 500 — so a mistyped link,
 * or someone probing the route, would take a page whose whole job is to
 * stay up and answer calmly offline. A bad segment degrades to the raw
 * text, which then simply fails to match anything.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = safeDecode(code);
  return (
    <>
      <section className="phead">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <span className="icbox" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}>
            <Icon name="shield-check" size={28} />
          </span>
          <p className="kicker" style={{ justifyContent: 'center' }}>Verify</p>
          {/* Only a code-shaped segment earns the page heading. An
              arbitrary URL path segment rendered as an <h1> is a spam
              and SEO surface on a page that is meant to read as an
              official check — anything else falls through to the form's
              own label, which is what the plain /verify page shows. */}
          {isTransactionCodeShape(clean) ? (
            <h1 style={{ margin: '0 auto' }}>{clean}</h1>
          ) : (
            <h1 style={{ margin: '0 auto' }}>Check your code</h1>
          )}
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 700 }}>
          <VerifyForm initialCode={clean} />
        </div>
      </section>
    </>
  );
}
