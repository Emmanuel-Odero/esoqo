import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { TicketBrowser } from '@/app/tickets/TicketBrowser';
import { fetchListings } from '@/lib/listings';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Concerts, shows, festivals and tours selling tickets on Esoqo — book direct, pay by M-Pesa, hold a QR ticket.',
};
export const dynamic = 'force-dynamic';

/**
 * The events half of what used to be /tickets — one directory, one kind
 * of listing. Organisers are real, registered Esoqo businesses rather
 * than a stranger's WhatsApp post, which is the whole reason a visitor
 * would trust this page over the group chat.
 */
export default async function EventsDirectory() {
  const listings = await fetchListings('EVENTS');

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Events</p>
          <h1>Events &amp; tours on Esoqo</h1>
          <p className="lead">
            Book straight from the organiser, not a tout or a screenshot. Pay by M-Pesa and hold a
            QR ticket on your own account — checked at the door, never a photocopy someone else can
            resell.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {listings.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>
                No events are published yet. Organisers open theirs from their Esoqo account — once
                they do, it appears here automatically.
              </p>
            </div>
          ) : (
            <TicketBrowser listings={listings} fixedVertical="EVENTS" />
          )}
        </div>
      </section>
    </>
  );
}
