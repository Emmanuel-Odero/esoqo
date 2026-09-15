import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { AuthorisationError } from '@esoqo/db';
import { requireOrgAccess } from '@/lib/session';
import { orgGo, type GoOrgBooking } from '@/lib/ticketing';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  PENDING_PAYMENT: 'var(--amber)', PAID: 'var(--green)', CANCELLED: 'var(--tx-2)', REFUNDED: 'var(--red)',
};

export default async function OrgBookings({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgAccess(orgId);
  // A SCANNER session (no booking.read) reaches requireOrgAccess fine —
  // this tab isn't in their nav, but a direct URL visit must still be
  // refused rather than crash.
  const bookings = await orgGo<{ bookings: GoOrgBooking[] }>(orgId, `/v1/ticketorgs/${orgId}/bookings`)
    .then((r) => r.bookings)
    .catch((e) => {
      if (e instanceof AuthorisationError) notFound();
      throw e;
    });

  return (
    <>
      <div className="mehead">
        <h1>Bookings</h1>
        <p>Every checkout made against this organiser's listings.</p>
      </div>

      {bookings.length === 0 ? (
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="coins" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>No bookings yet</h2>
            <p style={{ margin: 0 }}>They will show up here as customers check out.</p>
          </div>
        </div>
      ) : (
        bookings.map((b) => (
          <div className="mcard" key={b.id} style={{ marginBottom: 12 }}>
            <h2>{b.listingTitle}</h2>
            <div className="mrow"><span className="k">Buyer</span><span className="v">{b.buyerName} · {b.buyerMsisdn}</span></div>
            <div className="mrow"><span className="k">Status</span>
              <span className="v" style={{ color: STATUS_TONE[b.status] }}>{b.status.toLowerCase().replace('_', ' ')}</span></div>
            <div className="mrow"><span className="k">Tickets</span><span className="v">{b.ticketCount}</span></div>
            <div className="mrow"><span className="k">Total</span>
              <span className="v mono">KES {Number(b.totalKes).toLocaleString('en-KE')}</span></div>
            <div className="mrow"><span className="k">Booked</span><span className="v">{new Date(b.createdAt).toLocaleString('en-KE')}</span></div>
          </div>
        ))
      )}
    </>
  );
}
