import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { actionListManualParcelOrgPayouts } from '../../actions';
import { ManualPayoutsConsole } from './ManualPayoutsConsole';

export const dynamic = 'force-dynamic';

/**
 * Courier-company payouts no automatic rail could clear.
 *
 * Every counter settlement now auto-splits and auto-pays a courier
 * company's cut via M-Pesa B2C/B2B the moment the sender's payment
 * clears — but a company onboarded with a bank account (no
 * disbursement integration exists for that yet) or with no payout
 * method set at all lands here instead of just silently going unpaid.
 * Anything Daraja kept refusing lands here too.
 */
export default async function ParcelOrgManualPayoutsPage() {
  const ctx = await requireStaff();
  const canPay = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const payouts = await actionListManualParcelOrgPayouts();

  const manual = payouts.filter((p) => p.status === 'MANUAL').length;
  const failed = payouts.filter((p) => p.status === 'FAILED').length;
  const total = payouts.reduce((sum, p) => sum + p.amountKes, 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Manual courier payouts</h1>
          <p>
            Courier companies&apos; own cut of a parcel, where nothing automatic could send it —
            a bank destination, no payout method configured, or Daraja refusing the request
            outright. Everything else pays out on its own.
          </p>
        </div>
      </div>

      {!canPay && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see what&apos;s owed but not mark it paid. That needs the{' '}
            <code className="mono">parcels.edit</code> permission.
          </span>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className={`kpi ${total > 0 ? 'a' : ''}`}>
          <span className="l">Owed, unpaid</span>
          <span className="n" style={{ color: total > 0 ? 'var(--amber)' : undefined }}>
            KES {total.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
          </span>
          <span className="sub">Across {payouts.length} {payouts.length === 1 ? 'payout' : 'payouts'}</span>
        </div>
        <div className="kpi">
          <span className="l">No automatic rail</span>
          <span className="n">{manual}</span>
          <span className="sub">Bank destination, or no payout method set</span>
        </div>
        <div className="kpi">
          <span className="l">Daraja refused</span>
          <span className="n">{failed}</span>
          <span className="sub">Still retried automatically for a while first</span>
        </div>
      </div>

      <ManualPayoutsConsole payouts={payouts} canPay={canPay} />
    </>
  );
}
