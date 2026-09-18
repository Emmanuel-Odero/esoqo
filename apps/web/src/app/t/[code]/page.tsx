import type { Metadata } from 'next';
import Link from 'next/link';
import { actionCheckParcelStatus } from '../../parcels/actions';
import { ParcelStatusPanel } from '../../parcels/ParcelStatusPanel';

/**
 * The short public tracking page every parcel SMS now links to.
 *
 * `/t/<code>` rather than nesting under `/parcels/track` because
 * the whole point is the length: this URL is appended to a 160-character
 * GSM-7 message, and notify.withTrack drops the link entirely rather
 * than push a message into a second billable segment (see its comment).
 * Every character saved here is a message that keeps its link.
 *
 * Guest-safe by design — the tracking code is the bearer credential,
 * the same convention a pickup code follows. Server-rendered on first
 * load so someone tapping the link on a slow connection sees their
 * parcel, not a spinner.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Parcel ${code.toUpperCase()} — Esoqo`,
    // Not indexable: these pages are addressed by a code that is a
    // credential, and a search engine holding a cached copy of one is
    // the same leak as a public bucket URL.
    robots: { index: false, follow: false },
  };
}

export default async function TrackByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await actionCheckParcelStatus(code.toUpperCase());
  const upper = code.toUpperCase();

  return (
    <section className="sec">
      <div className="wrap" style={{ maxWidth: 480 }}>
        {res.kind === 'found' ? (
          <div className="card">
            <ParcelStatusPanel parcel={res.parcel} />
          </div>
        ) : res.kind === 'not-found' ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>We couldn&apos;t find that parcel</h2>
            <p className="sub">
              The code <span className="mono">{upper}</span> didn&apos;t match anything.
              Check it against your text message — codes look like <span className="mono">PKG-XXXXXX</span>.
            </p>
            <Link className="btn btn-o btn-sm" href="/parcels/track">Try another code</Link>
          </div>
        ) : (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>We couldn&apos;t check that parcel</h2>
            <p className="sub">{res.error}</p>
            <Link className="btn btn-o btn-sm" href="/parcels/track">Try again</Link>
          </div>
        )}

        <p className="sub" style={{ marginTop: 16, fontSize: '.85rem', textAlign: 'center' }}>
          <Link href="/parcels/send">Send a parcel</Link>
          {' · '}
          <Link href="/parcels/track">Track another</Link>
        </p>
      </div>
    </section>
  );
}
