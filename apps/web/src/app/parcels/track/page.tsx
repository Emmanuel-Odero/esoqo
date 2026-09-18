import type { Metadata } from 'next';
import Link from 'next/link';
import { TrackParcelForm } from './TrackParcelForm';

export const metadata: Metadata = {
  title: 'Track a parcel',
  description: 'Follow a parcel with the code you were given — no account needed.',
};

/** Guest-safe by design — GET /v1/parcels/:code/status takes no auth,
 *  same convention a pickup code follows (see handleGetParcelStatus's
 *  own comment in services/core-go). The parcel code itself is the
 *  bearer credential here. Static, no server data: the lookup happens
 *  in the browser, so the page itself opens instantly. */
export default function TrackParcelPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Track a parcel</h1>
          <p className="lead">Enter the code you were given when you sent — or were sent — a parcel.</p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 480 }}>
          <TrackParcelForm />
          <p className="sub" style={{ textAlign: 'center', marginTop: 18, fontSize: '.88rem' }}>
            Sending one? <Link href="/parcels/send">Book a parcel</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
