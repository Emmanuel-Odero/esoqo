import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { getCustomerDetail } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { CustomerActions } from './CustomerActions';

export const metadata: Metadata = { title: 'Customer' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const LEDGER_LABEL: Record<string, string> = { SALE: 'Sale on account', PAYMENT: 'Payment received', REFUND: 'Refund', ADJUSTMENT: 'Adjustment' };
const LOYALTY_LABEL: Record<string, string> = { EARN: 'Earned', REDEEM: 'Redeemed', ADJUSTMENT: 'Adjusted' };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSubject();

  let detail;
  try {
    detail = await getCustomerDetail(ctx, id);
  } catch {
    notFound();
  }
  const { customer, ledger, loyalty, balanceKes, points } = detail;

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>{customer.name ?? customer.msisdn}</h1>
          <p className="sub mono">{customer.msisdn}</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi anim-in anim-in-d1">
          <span className={`icon ${balanceKes > 0 ? 'a' : 'g'}`}><Icon name="coins" size={18} /></span>
          <div><span className="n">{kes(Math.abs(balanceKes))}</span><span className="l">{balanceKes > 0 ? 'Owed to you' : balanceKes < 0 ? 'In credit' : 'Settled up'}</span></div>
        </div>
        <div className="kpi anim-in anim-in-d2">
          <span className="icon b"><Icon name="star" size={18} /></span>
          <div><span className="n">{points}</span><span className="l">Loyalty points</span></div>
        </div>
      </div>

      <div style={{ margin: '18px 0' }}>
        <CustomerActions customerId={customer.id} balanceKes={balanceKes} name={customer.name} notes={customer.notes} />
      </div>

      {customer.notes && <p className="sub" style={{ marginBottom: 18 }}>{customer.notes}</p>}

      <div className="sect-h anim-in"><h2>Credit book</h2></div>
      {ledger.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>No credit activity yet.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td>{dateFmt(e.createdAt)}</td>
                  <td>{LEDGER_LABEL[e.kind] ?? e.kind}</td>
                  <td className="mono" style={{ color: Number(e.amountKes) > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {Number(e.amountKes) > 0 ? '+' : ''}{kes(Number(e.amountKes))}
                  </td>
                  <td>{e.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loyalty.length > 0 && (
        <>
          <div className="sect-h anim-in"><h2>Loyalty history</h2></div>
          <div className="card tbl-wrap" style={{ padding: 0 }}>
            <table className="dtbl">
              <thead><tr><th>Date</th><th>Type</th><th>Points</th><th>Note</th></tr></thead>
              <tbody>
                {loyalty.map((e) => (
                  <tr key={e.id}>
                    <td>{dateFmt(e.createdAt)}</td>
                    <td>{LOYALTY_LABEL[e.kind] ?? e.kind}</td>
                    <td className="mono" style={{ color: e.points > 0 ? 'var(--green)' : 'var(--tx-2)' }}>{e.points > 0 ? '+' : ''}{e.points}</td>
                    <td>{e.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
