'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCancelBooking } from '../../actions';

interface BookingRow {
  id: string; listingTitle: string; buyerName: string; buyerMsisdn: string;
  status: string; paymentMethod: string; totalKes: number;
  ticketCount: number; checkedInCount: number; createdAt: string;
}

const STATUS_PILL: Record<string, string> = { PENDING_PAYMENT: 'p-warn', PAID: 'p-ok', CANCELLED: 'p-bad', REFUNDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Pending payment', PAID: 'Paid', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' };

export function BookingsPanel({ orgId, canCancel, bookings }: { orgId: string; canCancel: boolean; bookings: BookingRow[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bookings.filter((b) => {
      if (status && b.status !== status) return false;
      if (!needle) return true;
      return b.buyerName.toLowerCase().includes(needle)
        || b.buyerMsisdn.toLowerCase().includes(needle)
        || b.listingTitle.toLowerCase().includes(needle);
    });
  }, [bookings, q, status]);

  function cancel(bookingId: string) {
    start(async () => {
      const r = await actionCancelBooking(orgId, bookingId);
      if (r.ok) announce('Booking cancelled.', 'polite');
      else announce(r.error, 'assertive');
    });
  }

  return (
    <>
      <div className="ctl">
        <div className="srch">
          <span className="mg"><Icon name="search" size={16} /></span>
          <input className="inp" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search bookings" placeholder="Buyer name, phone, or listing…" />
        </div>
        <select className="inp" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="coins" size={22} /></span>
            <h3>{bookings.length === 0 ? 'No bookings yet' : 'No bookings match'}</h3>
            {bookings.length === 0 && <p style={{ margin: 0 }}>They will show up here as customers check out.</p>}
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Listing</th><th>Buyer</th><th className="num">Total</th><th className="num">Tickets</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.listingTitle}</strong><span className="sub" style={{ display: 'block' }}>{new Date(b.createdAt).toLocaleString('en-KE')}</span></td>
                  <td>{b.buyerName}<span className="sub" style={{ display: 'block' }}>{b.buyerMsisdn}</span></td>
                  <td className="num mono">KES {b.totalKes.toLocaleString('en-KE')}</td>
                  <td className="num">{b.checkedInCount}/{b.ticketCount} checked in</td>
                  <td><span className={`pill ${STATUS_PILL[b.status]}`}>{STATUS_LABEL[b.status] ?? b.status}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    {canCancel && (b.status === 'PAID' || b.status === 'PENDING_PAYMENT') && (
                      <button className="btn btn-d btn-sm" disabled={pending} onClick={() => cancel(b.id)}>
                        <Icon name="ban" size={13} />Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
