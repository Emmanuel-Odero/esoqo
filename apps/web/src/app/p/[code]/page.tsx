import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { actionCheckParcelStatus } from '../../parcels/actions';
import { ParcelStatusPanel } from '../../parcels/ParcelStatusPanel';

/**
 * Where a scanned parcel label lands.
 *
 * `/t/<code>` is what SMS links to and is deliberately the shortest URL
 * we can make, because every character competes with a 160-character
 * message segment. This is the other one: a label's QR has no such
 * budget, so it can carry the signature (`?k=`) that lets this page say
 * whether the sticker somebody is holding is genuinely ours before it
 * shows them anything else.
 *
 * That verdict is the point. A label is trivial to photocopy, and
 * without a check a counterfeit is indistinguishable from the real
 * thing — on the box and on the page it resolves to. With one, forging
 * our labels becomes actively counterproductive: every fake scans to a
 * page that says so.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Parcel ${code.toUpperCase()} — Esoqo`,
    // Same reasoning as /t/: these pages are addressed by a code that
    // is a credential, and a search engine holding a cached copy of one
    // is a credential leak with no expiry.
    robots: { index: false, follow: false },
  };
}

export default async function ScannedLabelPage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const [{ code }, { k }] = await Promise.all([params, searchParams]);
  const res = await actionCheckParcelStatus(code.toUpperCase(), k);
  const parcel = res.kind === 'found' ? res.parcel : null;

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Parcel {code.toUpperCase()}</h1>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          {/* The verdict comes first, above anything about the parcel.
              Somebody who scanned a forgery needs to know that before
              they read a status that would only lend it credibility. */}
          <Verdict verdict={parcel && !('message' in parcel) ? parcel.labelVerdict : undefined} />
          {res.kind === 'found'
            ? <ParcelStatusPanel parcel={res.parcel} />
            : res.kind === 'not-found'
              ? <NotFound code={code.toUpperCase()} />
              : <Unavailable message={res.error} />}
        </div>
      </section>
    </>
  );
}

/**
 * Three states, not two.
 *
 * "unverified" is the load-bearing one: a code typed by hand, or a
 * label printed before signing existed, carries no signature at all.
 * Treating that as a forgery would show a red warning to honest people
 * doing an ordinary thing — so absent and wrong are kept apart, and
 * only wrong gets the alarm.
 */
function Verdict({ verdict }: { verdict?: string }) {
  if (verdict === 'genuine') {
    return (
      <div className="chain" style={{ background: 'var(--green-t, #EAF6EE)', border: '1px solid #B9DEC6', color: 'var(--green, #1C7C3E)', marginBottom: 14 }}>
        <Icon name="shield-check" size={18} />
        <span>Genuine Esoqo label.</span>
      </div>
    );
  }
  if (verdict === 'forged') {
    return (
      <div className="chain" style={{ background: 'var(--red-t, #FDEDED)', border: '1px solid #F0BDBD', color: 'var(--red, #B3261E)', marginBottom: 14 }}>
        <Icon name="alert-triangle" size={18} />
        <span>
          <strong>This is not a genuine Esoqo label.</strong> The code on it may still be real,
          but the sticker was not printed by us — please don&apos;t hand anything over on the
          strength of it.
        </span>
      </div>
    );
  }
  // Unverified: say nothing. A quiet absence of a badge is the honest
  // rendering of "we can't tell", and dressing it up either way would
  // be claiming knowledge we don't have.
  return null;
}

function NotFound({ code }: { code: string }) {
  return (
    <div className="card" style={{ padding: 20, textAlign: 'center' }}>
      <Icon name="alert-circle" size={28} />
      <p style={{ margin: '10px 0 2px', fontWeight: 700 }}>
        No parcel or label with the code <span className="mono">{code}</span>.
      </p>
      <p className="sub" style={{ margin: 0 }}>
        Check the code against the label, or try again in a moment if it was only just printed.
      </p>
      <p style={{ marginTop: 14 }}>
        <Link className="btn btn-o btn-sm" href="/parcels/track">Track a different parcel</Link>
      </p>
    </div>
  );
}

/** A scanner whose side of the system is down shouldn't be told their
 *  badged code doesn't exist — a service failure and a 404 are different
 *  facts, and only the latter means "no parcel". */
function Unavailable({ message }: { message: string }) {
  return (
    <div className="card" style={{ padding: 20, textAlign: 'center' }}>
      <Icon name="alert-circle" size={28} />
      <p style={{ margin: '10px 0 2px', fontWeight: 700 }}>We couldn&apos;t check that parcel</p>
      <p className="sub" style={{ margin: 0 }}>{message}</p>
      <p style={{ marginTop: 14 }}>
        <Link className="btn btn-o btn-sm" href="/parcels/track">Try again</Link>
      </p>
    </div>
  );
}
