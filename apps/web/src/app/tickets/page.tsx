import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { TicketBrowser } from './TicketBrowser';
import { fetchListings } from '@/lib/listings';

export const metadata: Metadata = {
  title: 'Events & transport',
  description: 'Events, tours and transport companies selling tickets on Esoqo — browse and book directly.',
};
export const dynamic = 'force-dynamic';

/**
 * The ticketing equivalent of /discover — a public directory, same job
 * for a fourth kind of Esoqo business (event companies, tour operators,
 * transport companies) that /discover already does for shops. Unlike
 * /discover (which links out to apps/store for checkout), booking
 * itself also happens here — localhost:3000/tickets/[slug] — since
 * 3001 is reserved for signed-in dashboards, not public storefronts.
 * Directory reads come from core-go (GET /v1/listings).
 *
 * Now the combined view, kept for links that came before the split into
 * /events and /transport; both hubs read the same listings through the
 * shared fetchListings helper.
 */
export default async function TicketsDirectory() {
  const listings = await fetchListings();

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Discover</p>
          <h1>Events &amp; transport on Esoqo</h1>
          <p className="lead">
            Every listing here belongs to a real, registered Esoqo business — an event company,
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
                No events or trips are published yet. Organisers open theirs from their Esoqo
                account — once they do, it appears here automatically.
              </p>
            </div>
          ) : (
            <TicketBrowser listings={listings} />
          )}
        </div>
      </section>
    </>
  );
}
