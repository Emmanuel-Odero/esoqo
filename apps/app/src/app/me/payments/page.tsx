import { Icon } from '@esoqo/ui';
import { getMyRecord, PAYMENT_APPROVAL_THRESHOLD } from '@esoqo/db';
import { requireSubject } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The person's view of their own registration fee payment.
 *
 * Deliberately shows the signature count without naming the approvers —
 * they can see the process is real and how far it has got, without the
 * internal names.
 *
 * This page is ONLY the Esoqo registration fee. Booking payments
 * (event/transport instalments) live with each booking on /me/tickets —
 * the two money flows used to be indistinguishable ("Payments" vs
 * tickets carrying their own pay buttons), so each page now names the
 * other as the door to the other flow.
 */
export default async function MyPayments() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const pay = me?.registration?.payment;

  if (!pay || pay.status === 'NOT_DECLARED') {
    return (
      <>
        <header className="hero" style={{ padding: '4px 0 14px' }}>
          <p className="kicker">Registration</p>
          <h1>Your payment</h1>
          <p className="lead">Registration fees, and where each one has got to. Booking payments live with each booking under <a href="/me/tickets">Tickets</a>.</p>
        </header>
        <div className="mcard mcard--premium">
          <div className="mempty">
            <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="coins" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing recorded</h2>
            <p style={{ margin: 0 }}>
              You have not told Esoqo about a registration payment. You can pay whenever
              you are ready and enter the code then — some group features wait on a join
              fee paid from the group treasury page.
            </p>
          </div>
        </div>
      </>
    );
  }

  const approvals = pay.approvals.filter((a) => a.decision === 'APPROVE').length;
  const rejected = pay.status === 'REJECTED';
  const confirmed = pay.status === 'CONFIRMED' || pay.status === 'WAIVED';

  const tone = confirmed ? 'ok' : rejected ? 'bad' : 'pending';

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Registration</p>
        <h1>Your payment</h1>
        <p className="lead">Registration fee, and where it has got to. Booking payments live with each booking under <a href="/me/tickets">Tickets</a>.</p>
      </header>

      <section className={`status-hero status-hero--${tone}`} aria-label="Payment status">
        <span className="status-hero-ic" aria-hidden="true">
          <Icon name={confirmed ? 'check-circle' : rejected ? 'alert-circle' : 'clock'} size={22} />
        </span>
        <span className="status-hero-t">
          <span className="k">{confirmed ? 'Received and confirmed' : rejected ? 'We could not find this payment' : 'Being checked'}</span>
          {pay.amountKes && <span className="v mono">KES {Number(pay.amountKes).toLocaleString('en-KE')}</span>}
        </span>
      </section>

      <div className="premium-stats" aria-label="Payment details">
        <div className="pstat">
          <span className="pstat-k">Reference</span>
          <span className="pstat-v mono" style={{ fontSize: '.92rem' }}>{pay.reference ?? '—'}</span>
          <span className="pstat-h">What you told us</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Method</span>
          <span className="pstat-v" style={{ fontSize: '.92rem' }}>{pay.method?.replace(/_/g, ' ').toLowerCase() ?? '—'}</span>
          <span className="pstat-h">How you paid</span>
        </div>
        <div className="pstat">
          <span className="pstat-k">Declared</span>
          <span className="pstat-v" style={{ fontSize: '.92rem' }}>{pay.declaredAt?.toLocaleDateString('en-KE') ?? '—'}</span>
          <span className="pstat-h">When you told us</span>
        </div>
      </div>

      {!confirmed && !rejected && (
        <div className="mcard">
          <div className="note n-amber">
            <div>
              <p>
                <strong>{approvals} of {PAYMENT_APPROVAL_THRESHOLD} checks done.</strong>{' '}
                Two different members of staff have to find your receipt and agree before this is
                marked as received. You will get an SMS when it is.
              </p>
            </div>
          </div>
        </div>
      )}

      {rejected && (
        <div className="mcard">
          <div className="note n-red">
            <div>
              <p>
                Esoqo could not match this reference to a payment. That is often a mistyped code
                rather than anything wrong. Call <strong className="mono">0709 000 000</strong> and
                someone will check it with you.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
