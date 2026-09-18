import type { Metadata } from 'next';
import Link from 'next/link';
import {
  actionListParcelAgents, actionListParcelPricing, actionListParcelZones,
  actionListWalkInStations,
} from '../actions';
import { SendParcelForm } from '../SendParcelForm';

export const metadata: Metadata = {
  title: 'Send a parcel',
  description: 'Enter your shipping details online — the fee is settled in person, with the agent or courier, not here.',
};
export const dynamic = 'force-dynamic';

/**
 * Guest parcel booking — same public boundary as /tickets checkout and
 * apps/store's storefront (ADR-0003). No sign-in anywhere on this page:
 * the sender types their own name/phone right on the form, same as the
 * receiver's. core-go's booking/pricing/pay/status endpoints are all
 * already unauthenticated for exactly this reason.
 *
 * No price or online payment anywhere on this page — every booking
 * lands as PAY_AT_COUNTER (see dbx.BookParcelInput's own comment) and
 * is settled in person, with the agent at a station or the courier on
 * pickup. `pricing` is fetched only for its weight brackets (matching a
 * typed weight to a parcel type) and label text — no KES figure from it
 * is ever rendered.
 *
 * Tracking lives on its own page (/parcels/track); this page is only
 * the booking form, so it stays short and focused.
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
        <div className="wrap" style={{ maxWidth: 620 }}>
          <SendParcelForm pricing={pricing} zones={zones} agents={agents} stations={stations} />

          <p className="sub" style={{ textAlign: 'center', marginTop: 18, fontSize: '.88rem' }}>
            Already sent one? <Link href="/parcels/track">Track it here</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
