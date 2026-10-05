import type { Metadata } from 'next';
import Link from 'next/link';
import { actionListParcelPricing, actionListWalkInStations } from '../actions';
import { actionGetCounterTicket } from '../counter-ticket-actions';
import { AtOfficeSendForm } from './AtOfficeSendForm';

export const metadata: Metadata = {
  title: 'Send a parcel',
  description: 'Standing at a courier’s counter? Check in step by step and get a case number for the clerk to call you by.',
};
export const dynamic = 'force-dynamic';

/**
 * /parcels/send — one question per screen, gated: you cannot reach
 * "what's inside" without first naming the office, the sender and the
 * receiver. A sender is standing at the counter filling this in, often
 * handing the phone back and forth with the clerk, which is served
 * better by one question at a time than a long page to scroll and
 * re-find a place in — the reason there is no second, scrolling form
 * on this site any more.
 */
export default async function SendParcelPage({
  searchParams,
}: { searchParams: Promise<{ ticket?: string }> }) {
  const { ticket: ticketId } = await searchParams;
  const [stations, pricing, ticket] = await Promise.all([
    actionListWalkInStations(),
    actionListParcelPricing(),
    // Opened from a counter ticket's "fill in details while you wait"
    // link (see CounterTicketStatus) — a WAITING ticket's own
    // draftDetails, if any, resumes the form exactly where it was left,
    // and the office step is skipped: the ticket's own org IS the
    // office the sender already checked in at.
    ticketId ? actionGetCounterTicket(ticketId) : Promise.resolve(null),
  ]);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Check in at the counter</h1>
          <p className="lead">
            One question at a time — tell us the office you&apos;re at, who it&apos;s for and
            what you&apos;re sending. At the end you&apos;ll get a case number to show the clerk.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          <AtOfficeSendForm
            stations={stations}
            pricing={pricing}
            ticketId={ticket ? ticketId : undefined}
            initialDraft={ticket?.draftDetails as Record<string, unknown> | null | undefined}
            lockedStationId={ticket?.orgId}
          />

          <p className="sub" style={{ textAlign: 'center', marginTop: 18, fontSize: '.88rem' }}>
            Already sent one? <Link href="/parcels/track">Track it here</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
