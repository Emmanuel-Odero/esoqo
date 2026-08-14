import { Icon } from '@esoko/ui';
import { getMyBookings } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { RetryPaymentButton } from './RetryPaymentButton';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Confirmed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

const TICKET_LABEL: Record<string, string> = {
  VALID: 'Valid',
  USED: 'Used',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

/**
 * Every subject's booking history — event tickets and transport
 * tickets side by side, same as Payments shows every registration fee
 * regardless of which group it belongs to.
 */
export default async function MyTickets() {
  const ctx = await requireSubject();
  const bookings = await getMyBookings(ctx);

  return (
    <>
      <div className="mehead">
        <h1>Your tickets</h1>
        <p>Events and transport bookings made on this account, oldest payment status first.</p>
      </div>

      <div className="mcard" style={{ marginBottom: 16 }}>
        <a href={`${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/tickets`} className="btn btn-o btn-block">
          <Icon name="search" size={16} />Browse events &amp; transport
        </a>
      </div>

      {bookings.length === 0 ? (
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="qr" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>No bookings yet</h2>
            <p style={{ margin: 0 }}>
              Once you book an event or a trip, your tickets and their QR codes show up here.
            </p>
          </div>
        </div>
      ) : (
        bookings.map((b) => (
          <div className="mcard" key={b.id} style={{ marginBottom: 14 }}>
            <h2>
              <Icon name={b.schedule.listing.org.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={18} />
              {b.schedule.listing.title}
            </h2>
            <div className="mrow"><span className="k">Organiser</span>
              <span className="v">{b.schedule.listing.org.name}</span></div>
            <div className="mrow"><span className="k">When</span>
              <span className="v">{b.schedule.departAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span></div>
            {(b.schedule.listing.venue || b.schedule.listing.route) && (
              <div className="mrow"><span className="k">Where</span>
                <span className="v">
                  {b.schedule.listing.venue?.name
                    ?? `${b.schedule.listing.route?.originName} → ${b.schedule.listing.route?.destinationName}`}
                </span></div>
            )}
            <div className="mrow"><span className="k">Status</span>
              <span className="v">{STATUS_LABEL[b.status] ?? b.status}</span></div>
            <div className="mrow"><span className="k">Total</span>
              <span className="v mono">KES {Number(b.totalKes).toLocaleString('en-KE')}</span></div>

            {b.status === 'PENDING_PAYMENT' && b.paymentMethod === 'MPESA_STK' && (
              <RetryPaymentButton bookingId={b.id} />
            )}

            <div style={{ marginTop: 10 }}>
              {b.tickets.map((t) => (
                <div key={t.id} className="note" style={{ marginBottom: 8 }}>
                  <div>
                    <p><strong>{t.holderName || b.buyerName}</strong> — {TICKET_LABEL[t.status] ?? t.status}</p>
                    <p className="mono" style={{ fontSize: '.82rem', wordBreak: 'break-all' }}>{t.code}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
