import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getPublicListing, getMyRecord } from '@esoko/db';
import { getCtx } from '@/lib/session';
import { BookingForm } from './BookingForm';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

const AMENITY_BADGES: Record<string, string> = {
  WIFI: '📶 WiFi', SNACKS: '🍪 Snacks', CHARGING: '🔌 Charging', RECLINING: '🛋️ Reclining',
  EXTRA_LEGROOM: '🦵 Extra legroom', BLANKET: '🧣 Blanket',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getPublicListing(slug).catch(() => null);
  return { title: listing?.title ?? 'Not found' };
}
export const dynamic = 'force-dynamic';

/**
 * Public checkout, signed in or not — same boundary as apps/store's
 * storefront. A signed-in subject's name/phone pre-fill from their
 * record; a guest fills them in on the form itself and gets tickets
 * issued to that phone (and email, if given), same as apps/store's
 * checkout captures a StoreCustomer from checkout details alone.
 */
export default async function TicketDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getPublicListing(slug).catch(() => null);
  if (!listing) notFound();

  const ctx = await getCtx();
  const signedIn = ctx.actorType === 'SUBJECT' && Boolean(ctx.partyId);
  const me = signedIn ? await getMyRecord(ctx) : null;
  const buyerName = me?.person?.knownAs || me?.person?.officialName || '';
  const buyerMsisdn = me?.person?.msisdn || '';
  const upcoming = listing.schedules.filter((s) => s.departAt > new Date());

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">{listing.org.vertical === 'TRANSPORT' ? 'Transport' : 'Events'}</p>
          <h1>{listing.title}</h1>
          <p className="lead">{listing.description || `Run by ${listing.org.name}`}</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="sub">Organiser</span><strong>{listing.org.name}</strong>
            </div>
            {(listing.venue || listing.route) && (
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <span className="sub">{listing.org.vertical === 'TRANSPORT' ? 'Route' : 'Venue'}</span>
                <strong>{listing.venue?.name ?? `${listing.route?.originName} → ${listing.route?.destinationName}`}</strong>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 12 }}>
              {listing.org.vertical === 'TRANSPORT' ? 'Seat classes' : 'Ticket options'}
            </h3>
            {listing.ticketClasses.map((c) => (
              <div key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{c.name}</strong>
                  <span className="mono">KES {Number(c.priceKes).toLocaleString('en-KE')}{c.seated ? ' / seat' : ''}</span>
                </div>
                {(c.amenities.length > 0 || c.amenityNote) && (
                  <p className="sub" style={{ margin: '4px 0 0', fontSize: '.82rem' }}>
                    {c.amenities.map((a) => AMENITY_BADGES[a] ?? a).join('  ')}
                    {c.amenityNote ? `  +${c.amenityNote}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>

          {upcoming.length === 0 ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="clock" size={20} /></span>
              <h3 style={{ marginBottom: 6 }}>Nothing scheduled right now</h3>
              <p className="sub" style={{ margin: 0 }}>Check back soon for the next occurrence.</p>
            </div>
          ) : (
            <BookingForm
              schedules={upcoming.map((s) => ({
                id: s.id, departAt: s.departAt.toISOString(),
                vehicleOrHallLabel: s.vehicleOrHallLabel, gateInfo: s.gateInfo,
              }))}
              ticketClasses={listing.ticketClasses.map((c) => ({
                id: c.id, name: c.name, priceKes: Number(c.priceKes), seated: c.seated, capacity: c.capacity,
                amenities: c.amenities, amenityNote: c.amenityNote,
              }))}
              seatMap={listing.seatMap ? { rows: listing.seatMap.rows, pattern: listing.seatMap.pattern, seats: listing.seatMap.seats } : null}
              signedIn={signedIn}
              installmentsEnabled={listing.org.installmentsEnabled}
              minDepositPercent={listing.org.minDepositPercent}
              buyerName={buyerName}
              buyerMsisdn={buyerMsisdn}
              signinUrl={`${APP_URL}/signin?next=${encodeURIComponent(`${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/tickets/${slug}`)}`}
            />
          )}
        </div>
      </section>
    </>
  );
}
