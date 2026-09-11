import type { Metadata } from 'next';
import { TrackParcelForm } from './TrackParcelForm';

export const metadata: Metadata = { title: 'Track a parcel — Esoko' };

/** Guest-safe by design — GET /v1/parcels/:code/status takes no auth,
 *  same convention a pickup code follows (see handleGetParcelStatus's
 *  own comment in services/core-go). The parcel code itself is the
 *  bearer credential here. */
export default function TrackParcelPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Track a parcel</h1>
          <p className="lead">Enter the code you were given when you sent (or were sent) a parcel.</p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 480 }}>
          <TrackParcelForm />
        </div>
      </section>
    </>
  );
}
