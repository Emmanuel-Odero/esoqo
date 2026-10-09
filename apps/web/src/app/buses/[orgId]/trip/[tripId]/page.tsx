import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTrip, getTripSeats, listTransportCompanies } from '../../../actions';
import { TripBookingForm } from './TripBookingForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Book a seat' };

export default async function TripPage({
  params, searchParams,
}: {
  params: Promise<{ orgId: string; tripId: string }>;
  searchParams: Promise<{ passengers?: string }>;
}) {
  const { orgId, tripId } = await params;
  const { passengers } = await searchParams;
  const [companies, trip, seats] = await Promise.all([
    listTransportCompanies(), getTrip(tripId), getTripSeats(tripId),
  ]);
  const company = companies.find((c) => c.id === orgId);
  if (!company || !trip) notFound();
  const requestedSeats = Math.max(1, Number(passengers) || 1);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">
            <Link href="/buses">Bus tickets</Link> · <Link href={`/buses/${orgId}`}>{company.name}</Link> ·{' '}
            <Link href={`/buses/${orgId}/route/${trip.routeId}`}>{trip.originName} → {trip.destinationName}</Link>
          </p>
          <h1>{trip.originName} → {trip.destinationName}</h1>
          <p className="lead">
            {new Date(trip.departAt).toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
            {' · '}{trip.busName} · KES {trip.priceKes.toLocaleString('en-KE')} per seat
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          <TripBookingForm trip={trip} seatsTotal={seats.seatsTotal} takenSeats={seats.takenSeats} requestedSeats={requestedSeats} />
        </div>
      </section>
    </>
  );
}
