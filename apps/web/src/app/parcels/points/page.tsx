import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { toCentsOrZero } from '@esoqo/domain';
import { actionListParcelAgents, actionListWalkInStations } from '../actions';

export const metadata: Metadata = {
  title: 'Drop-off & pickup points',
  description: 'Stations to hand a parcel in, and neighbourhood shops where a receiver can collect one.',
};
export const dynamic = 'force-dynamic';

/**
 * Two genuinely different halves of the same journey, kept separate
 * because a sender and a receiver need opposite ends of it:
 *
 *  - Walk-in stations: where a sender hands a parcel over in person
 *    instead of waiting for a pickup.
 *  - Pickup points: neighbourhood shops a receiver can walk to, the
 *    cheaper delivery leg.
 *
 * Both come straight from core-go's public endpoints, so this page
 * adds no new data or contract — it just makes what the platform
 * already knows browsable without going through the booking form.
 */
export default async function ParcelPointsPage() {
  const [stations, agents] = await Promise.all([
    actionListWalkInStations(),
    actionListParcelAgents(),
  ]);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Drop-off &amp; pickup points</h1>
          <p className="lead">
            Hand a parcel in at a station, or have it collected from a nearby shop. No account, no
            online payment at any of them.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2 id="stations" style={{ marginBottom: 4 }}>Hand it in yourself</h2>
          <p className="sub" style={{ margin: '0 0 20px' }}>
            Walk in and drop your parcel off — no waiting for a rider. You can pick one of these in
            the booking form too.
          </p>

          {stations.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>No walk-in stations are open yet. Book a scheduled pickup instead.</p>
            </div>
          ) : (
            <div className="grid g3">
              {stations.map((s) => (
                <div className="card" key={s.id}>
                  <span className="icbox icbox-g" style={{ marginBottom: 12 }}>
                    <Icon name="building" size={18} />
                  </span>
                  <h3 style={{ marginBottom: 6, fontSize: '1rem' }}>{s.name}</h3>
                  <p className="sub" style={{ margin: 0, fontSize: '.9rem' }}>{s.locationHint}</p>
                  {s.openingHours && (
                    <p className="sub" style={{ margin: '6px 0 0', fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="clock" size={14} />Open {s.openingHours}
                    </p>
                  )}
                  {s.lat != null && s.lng != null && (
                    <a style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontWeight: 600, fontSize: '.88rem' }}
                      target="_blank" rel="noreferrer"
                      href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`}>
                      <Icon name="pin" size={14} />Directions
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <h2 id="pickup" style={{ marginBottom: 4 }}>Collect from a shop</h2>
          <p className="sub" style={{ margin: '0 0 20px' }}>
            Pick a nearby shop as the delivery address and the receiver walks in to collect — usually
            cheaper than a door-to-door courier.
          </p>

          {agents.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>No pickup shops are listed yet. Choose door delivery when you book.</p>
            </div>
          ) : (
            <div className="grid g3">
              {agents.map((a) => (
                <div className="card" key={a.id}>
                  <span className="icbox icbox-a" style={{ marginBottom: 12 }}>
                    <Icon name="shop" size={18} />
                  </span>
                  <h3 style={{ marginBottom: 6, fontSize: '1rem' }}>{a.name}</h3>
                  <p className="sub" style={{ margin: 0, fontSize: '.9rem' }}>{a.locationHint}</p>
                  {a.openingHours && (
                    <p className="sub" style={{ margin: '6px 0 0', fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="clock" size={14} />Open {a.openingHours}
                    </p>
                  )}
                  {toCentsOrZero(a.holdingFeeKes) > 0 && (
                    <p className="sub" style={{ margin: '6px 0 0', fontSize: '.85rem' }}>
                      A collection fee applies at the shop.
                    </p>
                  )}
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <a className="btn btn-o btn-sm" href={`tel:${a.msisdn}`}>
                      <Icon name="phone" size={14} />Call
                    </a>
                    <a className="btn btn-o btn-sm" target="_blank" rel="noreferrer"
                      href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`}>
                      <Icon name="pin" size={14} />Directions
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
