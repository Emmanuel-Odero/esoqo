import { cookies } from 'next/headers';
import { Icon } from '@esoqo/ui';
import { SESSION_COOKIE } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';
import { goUrl, type GoMyBooking } from '@/lib/ticketing';
import { TicketsClient } from './TicketsClient';

export const dynamic = 'force-dynamic';

/**
 * Every subject's booking history — event tickets and transport
 * tickets side by side, same as Payments shows every registration fee
 * regardless of which group it belongs to. Reads come from core-go
 * (GET /v1/me/bookings, the getMyBookings port). Filtering, search and
 * pagination live in TicketsClient — the server just delivers the
 * history in one fetch.
 */
export default async function MyTickets() {
  await requireSubject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const bookings: GoMyBooking[] = token
    ? await fetch(goUrl('/v1/me/bookings'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : { bookings: [] }))
        .then((j) => ((j?.bookings ?? []) as GoMyBooking[]))
        .catch(() => [])
    : [];

  return (
    <>
      <div className="mehead">
        <h1>Your tickets</h1>
        <p>Events and transport bookings on this account — search, filter, newest first.</p>
      </div>

      <div className="mcard" style={{ marginBottom: 16 }}>
        <a href={`${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/tickets`} className="btn btn-o btn-block">
          <Icon name="search" size={16} />Browse events &amp; transport
        </a>
        {/* Vouchers/loyalty now live inside Wallet, not their own page —
            Tickets and Wallet are related (both are "what I can spend")
            but separate jobs, so they stay separate pages with a door
            between them. */}
        <a href="/me/wallet" className="btn btn-o btn-block" style={{ marginTop: 8 }}>
          <Icon name="tag" size={16} />Wallet, vouchers &amp; loyalty
        </a>
      </div>

      <TicketsClient bookings={bookings} />
    </>
  );
}
