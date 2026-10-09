import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { findCompanyTrips, listCompanyStations, listTransportCompanies } from '../actions';
import { StationSearchForm } from './StationSearchForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }): Promise<Metadata> {
  const { orgId } = await params;
  const companies = await listTransportCompanies();
  const company = companies.find((c) => c.id === orgId);
  return { title: company ? `${company.name} — routes` : 'Bus routes' };
}

// A trip's own departAt as a Nairobi calendar date (YYYY-MM-DD),
// matching how the date picker on the search form collects it.
function nairobiDateString(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(iso));
}

/**
 * The traveller's actual starting point: where do you board, and
 * where do you alight — not which route it technically is. A route
 * from Nairobi to Homabay via Kisii should surface for a Kisii rider
 * too, which is why this searches the company's station network
 * (the SAME one its parcel runs use) rather than only listing each
 * route's overall endpoints.
 *
 * "Find buses" drops the traveller straight into the list of
 * departures on the matching date — same one-step shape as other bus
 * booking sites — rather than making them pick a route card first.
 * When more than one of the company's routes connects the two
 * stations, their trips are merged into a single list sorted by
 * departure time; nothing in the UI needs to know which route carried
 * which trip.
 *
 * Nothing below the search card until a from/to/date is picked —
 * dumping every route the company has ever published (several of
 * which may have no upcoming trips at all) is noise, not a useful
 * fallback.
 */
export default async function CompanyRoutesPage({
  params, searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ from?: string; to?: string; date?: string; passengers?: string }>;
}) {
  const { orgId } = await params;
  const { from, to, date, passengers } = await searchParams;
  const [companies, stations] = await Promise.all([listTransportCompanies(), listCompanyStations(orgId)]);
  const company = companies.find((c) => c.id === orgId);
  if (!company) notFound();

  const passengerCount = Math.max(1, Number(passengers) || 1);
  const searching = Boolean(from && to && date);
  const allTrips = searching ? await findCompanyTrips(orgId, from!, to!) : [];
  const trips = (date ? allTrips.filter((t) => nairobiDateString(t.departAt) === date) : allTrips)
    .filter((t) => t.seatsAvailable >= passengerCount);
  const fromName = stations.find((s) => s.id === from)?.name;
  const toName = stations.find((s) => s.id === to)?.name;
  const tripQs = `?passengers=${passengerCount}`;

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker"><Link href="/buses">Bus tickets</Link></p>
          <h1>{company.name}</h1>
          <p className="lead">Where are you boarding, and where are you getting off?</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {stations.length >= 2 ? (
            <StationSearchForm
              orgId={orgId} stations={stations} initialFrom={from} initialTo={to} initialDate={date}
              initialPassengers={passengers}
            />
          ) : (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>This company hasn&apos;t published its stations yet.</p>
            </div>
          )}
        </div>
      </section>

      {searching && (
        <section className="sec">
          <div className="wrap">
            <h2 style={{ marginBottom: 16 }}>{fromName ?? 'From'} → {toName ?? 'To'}</h2>
            {trips.length === 0 ? (
              <div className="note n-blue">
                <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
                <p>
                  {passengerCount > 1
                    ? `No departures with ${passengerCount} seats free on that date — try another day or fewer passengers.`
                    : 'No departures on that date — try another day.'}
                </p>
              </div>
            ) : (
              <div className="grid g3">
                {trips.map((t) => (
                  <Link key={t.id} className="card" href={`/buses/${orgId}/trip/${t.id}${tripQs}`} style={{ display: 'block' }}>
                    <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
                      <Icon name="clock" size={20} />
                    </span>
                    <h3 style={{ marginBottom: 4 }}>
                      {new Date(t.departAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                    </h3>
                    <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>
                      {t.originName} → {t.destinationName}
                    </p>
                    <p className="sub" style={{ margin: '4px 0 0', fontSize: '.88rem' }}>
                      {t.busName} · KES {t.priceKes.toLocaleString('en-KE')} · {t.seatsAvailable} seats left
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
