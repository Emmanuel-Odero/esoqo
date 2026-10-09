import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checkBusBookingStatus } from '../../actions';
import { BookingStatusClient } from './BookingStatusClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your booking' };

/** The booking's own page — public, the code is the secret (same
 *  convention /tickets/booking/[bookingId] uses). Bookmark-able so a
 *  passenger whose STK prompt they missed can come back and retry,
 *  and the receipt a counter clerk can show a passenger on the spot. */
export default async function BusBookingPage({
  params,
}: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const booking = await checkBusBookingStatus(code);
  if (!booking) notFound();

  return (
    <section className="sec">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <BookingStatusClient code={code} initial={booking} />
      </div>
    </section>
  );
}
