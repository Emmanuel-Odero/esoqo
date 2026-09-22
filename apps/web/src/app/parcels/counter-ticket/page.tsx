import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { actionListWalkInStations } from '../actions';
import { CounterTicketRequestForm } from './CounterTicketRequestForm';
import type { CounterTicketChannel } from '../counter-ticket-actions';

/**
 * Where a counter's own QR code (or its kiosk) opens.
 *
 * `?org=<id>` names which company's desk this is — printed on the QR
 * itself or baked into the kiosk's own bookmark, never chosen here, so
 * a customer standing at Branch A's counter can't accidentally join
 * Branch B's queue. `?channel=KIOSK` is the one override a shared
 * counter device sets; anyone else opening this from their own phone
 * is WEB_QR.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Request service — Esoqo',
  robots: { index: false, follow: false },
};

export default async function CounterTicketRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; channel?: string }>;
}) {
  const { org, channel } = await searchParams;
  const stations = org ? await actionListWalkInStations() : [];
  const station = stations.find((s) => s.id === org);

  const resolvedChannel: CounterTicketChannel = channel === 'KIOSK' ? 'KIOSK' : 'WEB_QR';

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Request service</h1>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 480 }}>
          {station ? (
            <CounterTicketRequestForm orgId={station.id} orgName={station.name} channel={resolvedChannel} />
          ) : (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <Icon name="alert-circle" size={28} />
              <p style={{ margin: '10px 0 2px', fontWeight: 700 }}>We couldn&apos;t find that counter</p>
              <p className="sub" style={{ margin: 0 }}>
                Ask a member of staff for the right QR code, or check with the front desk.
              </p>
              <p style={{ marginTop: 14 }}>
                <Link className="btn btn-o btn-sm" href="/parcels">Back to Parcels</Link>
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
