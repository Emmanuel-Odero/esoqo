import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import {
  actionListParcelAgents, actionListParcelPricing, actionListParcelZones,
  actionListWalkInStations,
} from './actions';
import { SendParcelForm } from './SendParcelForm';
import { TrackParcelForm } from './track/TrackParcelForm';

export const metadata: Metadata = {
  title: 'Send a parcel — Esoqo',
  description: 'Enter your shipping details online — the fee is settled in person, with the agent or courier, not here.',
};
export const dynamic = 'force-dynamic';

/**
 * Guest parcel booking — same public boundary as /tickets checkout and
 * apps/store's storefront (ADR-0003). No sign-in anywhere on this page:
 * the sender types their own name/phone right on the form, same as the
 * receiver's. core-go's booking/pricing/pay/status endpoints are all
 * already unauthenticated for exactly this reason (see
 * handleBookParcel/handleGetParcelPricing/handleGetParcelStatus's own
 * comments in services/core-go) — this page is the first thing that
 * actually calls them without a session.
 *
 * No price or online payment anywhere on this page — every booking
 * lands as PAY_AT_COUNTER (see dbx.BookParcelInput's own comment) and
 * is settled in person, with the agent at a station or the courier on
 * pickup. `pricing` is still fetched, but only for its weight brackets
 * (matching a typed weight to a parcel type) and label text — no KES
 * figure from it is ever rendered.
 */
export default async function SendParcelPage() {
  const [pricing, zones, agents, stations] = await Promise.all([
    actionListParcelPricing(),
    actionListParcelZones(),
    actionListParcelAgents(),
    actionListWalkInStations(),
  ]);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Send a parcel</h1>
          <p className="lead">
            Tell us what you&apos;re sending and where it&apos;s going — the fee is settled in person,
            with the agent or courier. No account needed; just your details and the receiver&apos;s.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="grid g3" style={{ marginBottom: 24 }}>
            <div className="card">
              <span className="icbox icbox-g" style={{ marginBottom: 10 }}><Icon name="truck" size={18} /></span>
              <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--tx-2)' }}>
                The fee is settled in person — with the agent or the courier, not online.
              </p>
            </div>
            <div className="card">
              <span className="icbox icbox-b" style={{ marginBottom: 10 }}><Icon name="box" size={18} /></span>
              <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--tx-2)' }}>
                Scanned into custody at every handoff — never "somewhere on a bus."
              </p>
            </div>
            <div className="card">
              <span className="icbox icbox-r" style={{ marginBottom: 10 }}><Icon name="key" size={18} /></span>
              <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--tx-2)' }}>
                Only your receiver's delivery code releases it to them.
              </p>
            </div>
          </div>

          <SendParcelForm pricing={pricing} zones={zones} agents={agents} stations={stations} />
        </div>
      </section>

      {/* Already sent one? The full tracker (code lookup, camera scan,
          and — for signed-in station staff — the receive/scan tools)
          lives right here too, not just at the separate /send-parcel/track
          URL, so nobody has to leave this page to follow a parcel they
          just booked. */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 640 }}>
          <h2 style={{ marginBottom: 4 }}>Track a parcel</h2>
          <p className="sub" style={{ margin: '0 0 16px' }}>
            Already have a code? Follow it here — no account needed.
          </p>
          <TrackParcelForm />
        </div>
      </section>
    </>
  );
}
