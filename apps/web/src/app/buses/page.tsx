import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { listTransportCompanies } from './actions';

export const metadata: Metadata = {
  title: 'Bus tickets',
  description: 'Courier companies that also run passenger buses — pick one, choose your route, and book a seat.',
};
export const dynamic = 'force-dynamic';

/**
 * The top of the bus-ticket funnel: every courier company that has
 * also turned on passenger transport (ParcelOrg.offersTransport).
 * Deliberately its own directory rather than folded into /tickets:
 * that page lists TicketOrg operators (event/tour/SACCO companies);
 * this one lists courier companies running a second product line on
 * the same business.
 */
export default async function BusesDirectory() {
  const companies = await listTransportCompanies();

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Bus tickets</p>
          <h1>Book a bus seat</h1>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {companies.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>No companies are running buses yet. Check back soon.</p>
            </div>
          ) : (
            <div className="grid g3">
              {companies.map((c) => (
                <Link key={c.id} className="card" href={`/buses/${c.id}`} style={{ display: 'block' }}>
                  {c.logoUrl ? (
                    <img
                      src={c.logoUrl}
                      alt={c.name}
                      style={{ height: 40, maxWidth: 140, objectFit: 'contain', marginBottom: 13 }}
                    />
                  ) : (
                    <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
                      <Icon name="truck" size={20} />
                    </span>
                  )}
                  <h3 style={{ marginBottom: 4 }}>{c.name}</h3>
                  <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>View routes &amp; book</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
