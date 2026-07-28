import { Icon } from '@esoko/ui';
import { getMyRecord, PAYMENT_APPROVAL_THRESHOLD } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The person's view of their own payment.
 *
 * Deliberately shows the signature count without naming the approvers —
 * they can see the process is real and how far it has got, without the
 * internal names.
 */
export default async function MyPayments() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const pay = me?.registration?.payment;

  if (!pay || pay.status === 'NOT_DECLARED') {
    return (
      <>
        <div className="mehead">
          <h1>Your payment</h1>
          <p>Registration fees, and where each one has got to.</p>
        </div>
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="coins" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing recorded</h2>
            <p style={{ margin: 0 }}>
              You have not told Esoko about a payment. Nothing is blocked — you can pay whenever
              you are ready and enter the code then.
            </p>
          </div>
        </div>
      </>
    );
  }

  const approvals = pay.approvals.filter((a) => a.decision === 'APPROVE').length;
  const rejected = pay.status === 'REJECTED';
  const confirmed = pay.status === 'CONFIRMED' || pay.status === 'WAIVED';

  return (
    <>
      <div className="mehead">
        <h1>Your payment</h1>
        <p>Registration fee, and where it has got to.</p>
      </div>

      <div className="mcard">
        <h2>
          <Icon name={confirmed ? 'check-circle' : rejected ? 'alert-circle' : 'clock'} size={18}
            style={{ color: confirmed ? 'var(--green)' : rejected ? 'var(--red)' : 'var(--amber)' }} />
          {confirmed ? 'Received and confirmed'
            : rejected ? 'We could not find this payment'
            : 'Being checked'}
        </h2>

        <div className="mrow"><span className="k">Reference</span>
          <span className="v mono">{pay.reference ?? '—'}</span></div>
        <div className="mrow"><span className="k">Method</span>
          <span className="v">{pay.method?.replace(/_/g, ' ').toLowerCase() ?? '—'}</span></div>
        {pay.amountKes && (
          <div className="mrow"><span className="k">Amount</span>
            <span className="v mono">KES {Number(pay.amountKes).toLocaleString('en-KE')}</span></div>
        )}
        <div className="mrow"><span className="k">You told us</span>
          <span className="v">{pay.declaredAt?.toLocaleDateString('en-KE') ?? '—'}</span></div>

        {!confirmed && !rejected && (
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--amber-t)',
            border: '1px solid #F0DDB6', borderRadius: 9 }}>
            <p style={{ margin: 0, fontSize: '.9rem', color: '#7A4E06' }}>
              <strong>{approvals} of {PAYMENT_APPROVAL_THRESHOLD} checks done.</strong>{' '}
              Two different members of staff have to find your receipt and agree before this is
              marked as received. You will get an SMS when it is.
            </p>
          </div>
        )}

        {rejected && (
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--red-t)',
            border: '1px solid #F3D2CF', borderRadius: 9 }}>
            <p style={{ margin: 0, fontSize: '.9rem', color: '#7A2320' }}>
              Esoko could not match this reference to a payment. That is often a mistyped code
              rather than anything wrong. Call <strong className="mono">0709 000 000</strong> and
              someone will check it with you.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
