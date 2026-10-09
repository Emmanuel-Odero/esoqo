'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { checkBusBookingStatus, type BusBookingStatus } from '../../actions';

/** Polls while an M-Pesa push is in flight — console mode never shows
 *  the waiting state at all, since the push auto-confirms before the
 *  booking page is first reached. Same shape BookingForm's own poll
 *  follows for a ticketing booking. */
export function BookingStatusClient({ code, initial }: { code: string; initial: BusBookingStatus }) {
  const [booking, setBooking] = useState(initial);
  const announce = useAnnounce();

  useEffect(() => {
    if (booking.status !== 'PENDING_PAYMENT') return;
    const t = setInterval(async () => {
      const res = await checkBusBookingStatus(code);
      if (res && res.status !== 'PENDING_PAYMENT') {
        setBooking(res);
        if (res.status === 'PAID') announce('Payment received.', 'polite');
      }
    }, 4000);
    return () => clearInterval(t);
  }, [booking.status, code, announce]);

  const when = new Date(booking.departAt).toLocaleString('en-KE', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi',
  });

  const seatWord = booking.seatNumbers.length > 1 ? 'seats' : 'seat';
  const seatList = booking.seatNumbers.join(', ');

  if (booking.status === 'PENDING_PAYMENT') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="phone-call" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Check your phone</h3>
        <p className="sub" style={{ margin: '0 0 16px' }}>
          Enter your M-Pesa PIN on the prompt sent to confirm your {seatWord}. This updates on its
          own once payment is received — no need to reload.
        </p>
        <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>
          {booking.originName} → {booking.destinationName}, {seatWord} {seatList}, {when}
        </p>
      </div>
    );
  }

  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="alert-triangle" size={20} /></span>
        <h3 style={{ marginBottom: 6 }}>Booking cancelled</h3>
        <p className="sub" style={{ margin: 0 }}>This booking is no longer active.</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={20} /></span>
      <h3 style={{ marginBottom: 6 }}>{booking.seatNumbers.length > 1 ? 'Seats booked' : 'Seat booked'}</h3>
      <p className="sub" style={{ margin: '0 0 8px' }}>
        {booking.originName} → {booking.destinationName}, {seatWord} {seatList}
      </p>
      <p className="sub" style={{ margin: '0 0 16px' }}>{when} · {booking.busName}</p>
      <p style={{ margin: '0 0 4px' }}>
        Booking code: <span className="mono" style={{ fontWeight: 700 }}>{booking.code}</span>
      </p>
      <p className="sub" style={{ margin: 0, fontSize: '.8rem' }}>
        Show this code when boarding. KES {booking.totalKes.toLocaleString('en-KE')} paid.
      </p>
    </div>
  );
}
