import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { listPublicListings } from '@esoko/db';
import { TicketBrowser } from './TicketBrowser';

export const metadata: Metadata = {
  title: 'Events & transport',
  description: 'Events, tours and transport companies selling tickets on Esoko — browse and book directly.',
};
export const dynamic = 'force-dynamic';

/**
 * The ticketing equivalent of /discover — a public directory, same job
 * for a fourth kind of Esoko business (event companies, tour operators,
 * transport companies) that /discover already does for shops. Unlike
 * /discover (which links out to apps/store for checkout), booking
 * itself also happens here — localhost:3000/tickets/[slug] — since
 * 3001 is reserved for signed-in dashboards, not public storefronts.
 */
export default async function TicketsDirectory() {
  const listings = await listPublicListings();

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Discover</p>
          <h1>Events &amp; transport on Esoko</h1>
          <p className="lead">
            Every listing here belongs to a real, registered Esoko business — an event company,
            tour operator, or transport company. Book directly, pay by M-Pesa, and get a QR ticket
            on your account.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {listings.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>
                No events or trips are published yet. Organisers open theirs from their Esoko
                account — once they do, it appears here automatically.
              </p>
            </div>
          ) : (
            <TicketBrowser
              listings={listings.map((l) => ({
                slug: l.slug,
                title: l.title,
                orgName: l.org.name,
                vertical: l.org.vertical,
                where: l.venue?.name ?? (l.route ? `${l.route.originName} → ${l.route.destinationName}` : null),
                county: l.venue?.county ?? null,
                fromKes: l.ticketClasses.length ? Math.min(...l.ticketClasses.map((c) => Number(c.priceKes))) : null,
                nextDepartAt: l.schedules[0]?.departAt.toISOString() ?? null,
                scheduleCount: l.schedules.length,
                detailUrl: `/tickets/${l.slug}`,
              }))}
            />
          )}
        </div>
      </section>
    </>
  );
}
