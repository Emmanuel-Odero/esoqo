'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import type { GoMyBooking } from '@/lib/ticketing';
import { RetryPaymentButton } from './RetryPaymentButton';
import { PayBalanceButton } from './PayBalanceButton';

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

const PER_PAGE = 8;

/**
 * Personal booking history as a filterable register.
 *
 * Was a wall of full cards, oldest-payment-status first, with no way to
 * find "next Saturday's bus" short of scrolling. Now: summary counts,
 * search + status/vertical filters, newest-departure-first sorting, and
 * client pagination — all local state, no extra round trips, at a scale
 * where the whole history fits one fetch.
 */
export function TicketsClient({ bookings }: { bookings: GoMyBooking[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [vertical, setVertical] = useState('');
  const [page, setPage] = useState(1);

  const now = useMemo(() => new Date(), []);
  const upcoming = bookings.filter((b) => new Date(b.departAt) >= now && b.status !== 'CANCELLED' && b.status !== 'REFUNDED').length;
  const pendingPay = bookings.filter((b) => b.status === 'PENDING_PAYMENT' || b.status === 'PARTIALLY_PAID').length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bookings
      .filter((b) => !status || b.status === status)
      .filter((b) => !vertical || b.vertical === vertical)
      .filter((b) =>
        !needle ||
        b.listingTitle.toLowerCase().includes(needle) ||
        b.orgName.toLowerCase().includes(needle) ||
        b.tickets.some((t) => t.code.toLowerCase().includes(needle)),
      )
      .sort((a, b) => +new Date(b.departAt) - +new Date(a.departAt));
  }, [bookings, q, status, vertical]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  function resetPage() {
    setPage(1);
  }

  return (
    <>
      <div className="tix-summary" role="status" aria-label="Bookings summary">
        <span className="tix-chip"><Icon name="calendar" size={14} />{upcoming} upcoming</span>
        {pendingPay > 0 && (
          <span className="tix-chip is-warn"><Icon name="coins" size={14} />{pendingPay} need payment</span>
        )}
        <span className="tix-chip is-mute">{bookings.length} total</span>
      </div>

      <div className="tix-filters">
        <input
          value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }}
          placeholder="Search event, organiser or ticket code"
          aria-label="Search bookings" className="inp tix-search"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="Filter by payment status" className="inp">
          <option value="">All payment states</option>
          <option value="PAID">Confirmed</option>
          <option value="PARTIALLY_PAID">Part-paid</option>
          <option value="PENDING_PAYMENT">Awaiting payment</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <select value={vertical} onChange={(e) => { setVertical(e.target.value); resetPage(); }} aria-label="Filter by type" className="inp">
          <option value="">Events + transport</option>
          <option value="TRANSPORT">Transport</option>
          <option value="EVENTS">Events</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="qr" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing matches</h2>
            <p style={{ margin: 0 }}>
              {bookings.length === 0
                ? 'Once you book an event or a trip, your tickets and their QR codes show up here.'
                : 'Try widening the search or clearing a filter.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {pageRows.map((b) => (
            <div className="mcard" key={b.id} style={{ marginBottom: 14 }}>
              <h2>
                <Icon name={b.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={18} />
                {b.listingTitle}
              </h2>
              <div className="mrow"><span className="k">Organiser</span>
                <span className="v">{b.orgName}</span></div>
              <div className="mrow"><span className="k">When</span>
                <span className="v">{new Date(b.departAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span></div>
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
                const totalAmt = Number(b.totalKes);
                const balance = Math.max(0, totalAmt - paid);
                return (
                  <>
                    <div className="mrow"><span className="k">Paid so far</span>
                      <span className="v mono">KES {paid.toLocaleString('en-KE')} / {totalAmt.toLocaleString('en-KE')}</span></div>
                    {b.balanceDueBy && (
                      <div className="mrow"><span className="k">Balance due</span>
                        <span className="v">{new Date(b.balanceDueBy).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span></div>
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
          ))}
          {totalPages > 1 && (
            <div className="tix-pager">
              <button className="btn btn-o btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Newer</button>
              <span className="mono">Page {safePage} of {totalPages}</span>
              <button className="btn btn-o btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Older →</button>
            </div>
          )}
        </>
      )}
      <p className="tix-browse">
        <Link href="/me/vouchers">Vouchers &amp; loyalty →</Link>
      </p>
    </>
  );
}
