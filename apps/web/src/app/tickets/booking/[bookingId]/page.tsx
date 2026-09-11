import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { BalancePayForm } from './BalancePayForm';

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pay your trip balance' };

interface GoBalanceView {
  id: string;
  status: string;
  buyerName: string;
  buyerMsisdn: string;
  totalKes: number;
  amountPaidKes: number;
  balanceKes: number;
  balanceDueBy: string | null;
  departAt: string;
  listingTitle: string;
  orgName: string;
  where: string | null;
  payments: { amountKes: number; kind: string; status: string; confirmedAt: string | null }[];
}

/**
 * Public "lipia pole pole" balance page. The booking id in the URL is
 * the secret — same trust model as the checkout status poll for a guest
 * booking (GET /v1/bookings/:id/balance-view). A buyer bookmarks this
 * from the checkout success screen or the SMS, and comes back to pay
 * the balance in whatever amounts they like before the trip.
 */
export default async function BookingBalancePage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const b: GoBalanceView | null = await fetch(
    `${CORE_GO_URL}/v1/bookings/${encodeURIComponent(bookingId)}/balance-view`,
    { cache: 'no-store' },
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j?.booking ?? null) as GoBalanceView | null)
    .catch(() => null);
  if (!b) notFound();

  const paidPct = b.totalKes > 0 ? Math.min(100, Math.round((b.amountPaidKes / b.totalKes) * 100)) : 0;
  const dueStr = b.balanceDueBy
    ? new Date(b.balanceDueBy).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })
    : null;
  const done = b.status === 'PAID';
  const dead = b.status === 'CANCELLED' || b.status === 'REFUNDED';

  return (
    <section className="sec">
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="kicker">Pay-in-portions</p>
          <h1 style={{ margin: '4px 0 10px', fontSize: '1.3rem' }}>{b.listingTitle}</h1>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="sub">Operator</span><strong>{b.orgName}</strong>
          </div>
          {b.where && (
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="sub">Route</span><strong>{b.where}</strong>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="sub">Departs</span>
            <strong>{new Date(b.departAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="sub">Passenger</span><strong>{b.buyerName}</strong>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="sub">Paid</span>
            <span className="mono" style={{ fontWeight: 700 }}>
              KES {b.amountPaidKes.toLocaleString('en-KE')} / {b.totalKes.toLocaleString('en-KE')}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ width: `${paidPct}%`, height: '100%', background: 'var(--green, #16a34a)' }} />
          </div>

          {done ? (
            <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
              <Icon name="check-circle" size={16} />Paid in full — your ticket is on its way to {b.buyerMsisdn}.
            </p>
          ) : dead ? (
            <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0, color: 'var(--red)' }}>
              <Icon name="alert-circle" size={16} />This plan is closed. Contact {b.orgName} about a refund of any amount paid.
            </p>
          ) : (
            <BalancePayForm
              bookingId={b.id}
              balanceKes={b.balanceKes}
              msisdn={b.buyerMsisdn}
              dueStr={dueStr}
            />
          )}

          {b.payments.filter((p) => p.status === 'CONFIRMED').length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <p className="sub" style={{ margin: '0 0 6px', fontSize: '.8rem', fontWeight: 600 }}>Payments so far</p>
              {b.payments.filter((p) => p.status === 'CONFIRMED').map((p, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between', fontSize: '.82rem' }}>
                  <span className="sub">
                    {p.kind === 'DEPOSIT' ? 'Deposit' : p.kind === 'BALANCE' ? 'Final payment' : 'Top-up'}
                    {p.confirmedAt ? ` · ${new Date(p.confirmedAt).toLocaleDateString('en-KE')}` : ''}
                  </span>
                  <span className="mono">KES {p.amountKes.toLocaleString('en-KE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
