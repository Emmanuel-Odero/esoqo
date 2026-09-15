import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { getMyRecord } from '@esoqo/db';
import { getCtx } from '@/lib/session';
import { BookingForm } from './BookingForm';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

const AMENITY_BADGES: Record<string, string> = {
  WIFI: '📶 WiFi', SNACKS: '🍪 Snacks', CHARGING: '🔌 Charging', RECLINING: '🛋️ Reclining',
  EXTRA_LEGROOM: '🦵 Extra legroom', BLANKET: '🧣 Blanket',
};

interface GoPublicListing {
  ID: string;
  Slug: string;
  Title: string;
  Description?: string | null;
  Vertical: string;
  Org?: { Name: string; Vertical: string; InstallmentsEnabled: boolean; MinDepositPercent: number } | null;
  Venue?: { Name: string } | null;
  Route?: { OriginName: string; DestinationName: string } | null;
  TicketClasses: {
    ID: string; Name: string; PriceKES: string; Seated: boolean; Capacity: number;
    Amenities: string[]; AmenityNote?: string | null;
  }[];
  Schedules: {
    ID: string; DepartAt: string; GateInfo?: string | null; VehicleOrHallLabel?: string | null; Status: string;
  }[];
  SeatMap?: { Rows: number; Pattern: string; Seats: { Label: string; TicketClassID: string }[] } | null;
}

async function getListing(slug: string): Promise<GoPublicListing | null> {
  const res = await fetch(`${CORE_GO_URL}/v1/listings/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as GoPublicListing | null;
  // Go embeds the detail at top level (flat struct), not under a key.
  return json && json.ID ? json : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListing(slug).catch(() => null);
  return { title: listing?.Title ?? 'Not found' };
}
export const dynamic = 'force-dynamic';

/**
 * Public checkout, signed in or not — same boundary as apps/store's
 * storefront. A signed-in subject's name/phone pre-fill from their
 * record; a guest fills them in on the form itself and gets tickets
 * issued to that phone (and email, if given), same as apps/store's
 * checkout captures a StoreCustomer from checkout details alone.
 * Listing reads come from core-go; only the buyer-record pre-fill
 * still touches the party record.
 */
export default async function TicketDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getListing(slug).catch(() => null);
  if (!listing || !listing.Org) notFound();

  const ctx = await getCtx();
  const signedIn = ctx.actorType === 'SUBJECT' && Boolean(ctx.partyId);
  const me = signedIn ? await getMyRecord(ctx) : null;
  const buyerName = me?.person?.knownAs || me?.person?.officialName || '';
  const buyerMsisdn = me?.person?.msisdn || '';
  const upcoming = listing.Schedules.filter((s) => new Date(s.DepartAt) > new Date());

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">{listing.Org.Vertical === 'TRANSPORT' ? 'Transport' : 'Events'}</p>
          <h1>{listing.Title}</h1>
          <p className="lead">{listing.Description || `Run by ${listing.Org.Name}`}</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="sub">Organiser</span><strong>{listing.Org.Name}</strong>
            </div>
            {(listing.Venue || listing.Route) && (
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <span className="sub">{listing.Org.Vertical === 'TRANSPORT' ? 'Route' : 'Venue'}</span>
                <strong>{listing.Venue?.Name ?? `${listing.Route?.OriginName} → ${listing.Route?.DestinationName}`}</strong>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 12 }}>
              {listing.Org.Vertical === 'TRANSPORT' ? 'Seat classes' : 'Ticket options'}
            </h3>
            {listing.TicketClasses.map((c) => (
              <div key={c.ID} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{c.Name}</strong>
                  <span className="mono">KES {Number(c.PriceKES).toLocaleString('en-KE')}{c.Seated ? ' / seat' : ''}</span>
                </div>
                {((c.Amenities?.length ?? 0) > 0 || c.AmenityNote) && (
                  <p className="sub" style={{ margin: '4px 0 0', fontSize: '.82rem' }}>
                    {(c.Amenities ?? []).map((a) => AMENITY_BADGES[a] ?? a).join('  ')}
                    {c.AmenityNote ? `  +${c.AmenityNote}` : ''}
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
                id: s.ID, departAt: s.DepartAt,
                vehicleOrHallLabel: s.VehicleOrHallLabel ?? undefined, gateInfo: s.GateInfo ?? undefined,
              }))}
              ticketClasses={listing.TicketClasses.map((c) => ({
                id: c.ID, name: c.Name, priceKes: Number(c.PriceKES), seated: c.Seated, capacity: c.Capacity,
                amenities: c.Amenities ?? [], amenityNote: c.AmenityNote ?? undefined,
              }))}
              seatMap={listing.SeatMap ? {
                rows: listing.SeatMap.Rows,
                pattern: listing.SeatMap.Pattern,
                seats: (listing.SeatMap.Seats ?? []).map((s) => ({ label: s.Label, ticketClassId: s.TicketClassID })),
              } : null}
              signedIn={signedIn}
              installmentsEnabled={listing.Org.InstallmentsEnabled}
              minDepositPercent={listing.Org.MinDepositPercent}
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
