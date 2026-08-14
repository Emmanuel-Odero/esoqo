import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { getPublicListing, getMyRecord } from '@esoko/db';
import { getCtx } from '@/lib/session';
import { BookingForm } from './BookingForm';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getPublicListing(slug).catch(() => null);
  return { title: listing?.title ?? 'Not found' };
}
export const dynamic = 'force-dynamic';

/**
 * Booking as a signed-in subject only, same boundary as apps/store's
 * checkout — but the sign-in flow itself lives on apps/app (3001),
 * since that's where every subject session originates. This page just
 * sends people there and back (?next=/tickets/[slug]).
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

          {upcoming.length === 0 ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="clock" size={20} /></span>
              <h3 style={{ marginBottom: 6 }}>Nothing scheduled right now</h3>
              <p className="sub" style={{ margin: 0 }}>Check back soon for the next occurrence.</p>
            </div>
          ) : !signedIn ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="lock" size={20} /></span>
              <h3 style={{ marginBottom: 6 }}>Sign in to book</h3>
              <p className="sub" style={{ margin: '0 0 16px' }}>Tickets are tied to your Esoko account so they're always in "My tickets".</p>
              <Link href={`${APP_URL}/signin?next=${encodeURIComponent(`${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/tickets/${slug}`)}`} className="btn btn-p">
                Sign in
              </Link>
            </div>
          ) : !buyerMsisdn ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="phone" size={20} /></span>
              <h3 style={{ marginBottom: 6 }}>Add a phone number first</h3>
              <p className="sub" style={{ margin: '0 0 16px' }}>Your tickets and payment prompt go to it.</p>
              <Link href={`${APP_URL}/me`} className="btn btn-p">Go to your Record</Link>
            </div>
          ) : (
            <BookingForm
              schedules={upcoming.map((s) => ({ id: s.id, departAt: s.departAt.toISOString() }))}
              ticketClasses={listing.ticketClasses.map((c) => ({ id: c.id, name: c.name, priceKes: Number(c.priceKes), seated: c.seated, capacity: c.capacity }))}
              buyerName={buyerName}
              buyerMsisdn={buyerMsisdn}
            />
          )}
        </div>
      </section>
    </>
  );
}
