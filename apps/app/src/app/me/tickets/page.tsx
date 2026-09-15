import { cookies } from 'next/headers';
import { Icon } from '@esoqo/ui';
import { SESSION_COOKIE } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';
import { goUrl, type GoMyBooking } from '@/lib/ticketing';
import { RetryPaymentButton } from './RetryPaymentButton';
import { PayBalanceButton } from './PayBalanceButton';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PARTIALLY_PAID: 'Part-paid',
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

type BookingView = Omit<GoMyBooking, 'departAt' | 'balanceDueBy'> & {
  departAt: Date;
  balanceDueBy: Date | null;
};

/**
 * Every subject's booking history — event tickets and transport
 * tickets side by side, same as Payments shows every registration fee
 * regardless of which group it belongs to. Reads come from core-go
 * (GET /v1/me/bookings, the getMyBookings port).
 */
export default async function MyTickets() {
  await requireSubject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const bookings: BookingView[] = token
    ? await fetch(goUrl('/v1/me/bookings'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : { bookings: [] }))
        .then((j) => ((j?.bookings ?? []) as GoMyBooking[]).map((b) => ({
          ...b,
          departAt: new Date(b.departAt),
          balanceDueBy: b.balanceDueBy ? new Date(b.balanceDueBy) : null,
        })))
        .catch(() => [])
    : [];

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
              <Icon name={b.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={18} />
              {b.listingTitle}
            </h2>
            <div className="mrow"><span className="k">Organiser</span>
              <span className="v">{b.orgName}</span></div>
            <div className="mrow"><span className="k">When</span>
              <span className="v">{b.departAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span></div>
            {(b.venueName || b.routeFrom) && (
              <div className="mrow"><span className="k">Where</span>
                <span className="v">
                  {b.venueName ?? `${b.routeFrom} → ${b.routeTo}`}
                </span></div>
            )}
            <div className="mrow"><span className="k">Status</span>
              <span className="v">{STATUS_LABEL[b.status] ?? b.status}</span></div>
            <div className="mrow"><span className="k">Total</span>
              <span className="v mono">KES {Number(b.totalKes).toLocaleString('en-KE')}</span></div>

            {b.isInstallment && (b.status === 'PENDING_PAYMENT' || b.status === 'PARTIALLY_PAID') && (() => {
              const paid = Number(b.amountPaidKes);
              const total = Number(b.totalKes);
              const balance = Math.max(0, total - paid);
              return (
                <>
                  <div className="mrow"><span className="k">Paid so far</span>
                    <span className="v mono">KES {paid.toLocaleString('en-KE')} / {total.toLocaleString('en-KE')}</span></div>
                  {b.balanceDueBy && (
                    <div className="mrow"><span className="k">Balance due</span>
                      <span className="v">{b.balanceDueBy.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span></div>
                  )}
                  <p className="note" style={{ margin: '8px 0 0', fontSize: '.82rem' }}>
                    Your ticket is issued once the balance is fully paid.
                  </p>
                  <PayBalanceButton bookingId={b.id} balanceKes={balance} />
                </>
              );
            })()}

            {!b.isInstallment && b.status === 'PENDING_PAYMENT' && b.paymentMethod === 'MPESA_STK' && (
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
