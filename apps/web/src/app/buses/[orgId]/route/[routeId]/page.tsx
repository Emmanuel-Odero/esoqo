import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { listCompanyRoutes, listRouteTrips, listTransportCompanies } from '../../../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Upcoming trips' };

/**
 * Every upcoming, seat-available departure on one route — the "get a
 * list of buses and their movement time" step. Trips are generated
 * on demand by the server the moment this route is searched (see
 * core-go's EnsureBusTripsGenerated), so a route nobody has looked at
 * recently still has the next two weeks ready to book.
 */
// A trip's own departAt as a Nairobi calendar date (YYYY-MM-DD),
// matching how the date picker on the search form collects it.
function nairobiDateString(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(iso));
}

export default async function RouteTripsPage({
  params, searchParams,
}: { params: Promise<{ orgId: string; routeId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { orgId, routeId } = await params;
  const { date } = await searchParams;
  const [companies, routes, allTrips] = await Promise.all([
    listTransportCompanies(), listCompanyRoutes(orgId), listRouteTrips(orgId, routeId),
  ]);
  const company = companies.find((c) => c.id === orgId);
  const route = routes.find((r) => r.id === routeId);
  if (!company || !route) notFound();

  const trips = date ? allTrips.filter((t) => nairobiDateString(t.departAt) === date) : allTrips;

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker"><Link href="/buses">Bus tickets</Link> · <Link href={`/buses/${orgId}`}>{company.name}</Link></p>
          <h1>{route.originName} → {route.destinationName}</h1>
          <p className="lead">
            {date
              ? `Departures on ${new Date(`${date}T00:00:00`).toLocaleDateString('en-KE', { dateStyle: 'full' })}.`
              : 'Pick a departure.'}
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {trips.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>{date ? 'No departures on that date — try another day.' : 'No seats available on this route right now — check back soon.'}</p>
            </div>
          ) : (
            <div className="grid g3">
              {trips.map((t) => (
                <Link key={t.id} className="card" href={`/buses/${orgId}/trip/${t.id}`} style={{ display: 'block' }}>
                  <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
                    <Icon name="clock" size={20} />
                  </span>
                  <h3 style={{ marginBottom: 4 }}>
                    {new Date(t.departAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                  </h3>
                  <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>
                    {t.busName} · KES {t.priceKes.toLocaleString('en-KE')} · {t.seatsAvailable} seats left
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
