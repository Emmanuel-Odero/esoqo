import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { actionListParcelPricing, actionListParcelZones } from './actions';
import { SendParcelForm } from './SendParcelForm';

export const metadata: Metadata = {
  title: 'Send a parcel — Esoko',
  description: 'Get a real price by weight and destination, pay by M-Pesa, and track it by handoff — no account needed.',
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
 */
export default async function SendParcelPage() {
  const [pricing, zones] = await Promise.all([
    actionListParcelPricing(),
    actionListParcelZones(),
  ]);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Send a parcel</h1>
          <p className="lead">
            A real price by weight and destination before you pay — not a number haggled at the
            matatu stage. No account needed; just your details and the receiver's.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="grid g3" style={{ marginBottom: 24 }}>
            <div className="card">
              <span className="icbox icbox-g" style={{ marginBottom: 10 }}><Icon name="truck" size={18} /></span>
              <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--tx-2)' }}>
                Priced by weight and destination, shown before you pay.
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

          <SendParcelForm pricing={pricing} zones={zones} />
        </div>
      </section>
    </>
  );
}
