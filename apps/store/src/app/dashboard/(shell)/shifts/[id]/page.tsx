import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { getShiftReport } from '@esoqo/db';
import { requireSubject } from '@/lib/session';

export const metadata: Metadata = { title: 'Z-report' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', MPESA_TILL: 'M-Pesa till', MPESA_STK: 'M-Pesa (STK)', ON_ACCOUNT: 'On account' };

export default async function ShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSubject();

  let report;
  try {
    report = await getShiftReport(ctx, id);
  } catch {
    notFound();
  }
  const { shift, saleCount, totalSalesKes, totalRefundsKes, paymentSplit, openingFloatKes, expectedCashKes, countedCashKes, varianceKes } = report;

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Z-report — {shift.cashier.name}</h1>
          <p className="sub">{dateFmt(shift.openedAt)}{shift.closedAt ? ` — ${dateFmt(shift.closedAt)}` : ' — still open'}</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi anim-in anim-in-d1">
          <span className="icon g"><Icon name="coins" size={18} /></span>
          <div><span className="n">{kes(totalSalesKes)}</span><span className="l">{saleCount} sale{saleCount !== 1 ? 's' : ''}</span></div>
        </div>
        <div className="kpi anim-in anim-in-d2">
          <span className="icon a"><Icon name="refresh" size={18} /></span>
          <div><span className="n">{kes(totalRefundsKes)}</span><span className="l">Refunds</span></div>
        </div>
        <div className="kpi anim-in anim-in-d3">
          <span className={`icon ${varianceKes === null ? 'b' : varianceKes === 0 ? 'g' : 'r'}`}><Icon name="scales" size={18} /></span>
          <div><span className="n">{varianceKes === null ? '—' : `${varianceKes >= 0 ? '+' : ''}${kes(varianceKes)}`}</span><span className="l">Cash variance</span></div>
        </div>
      </div>

      <div className="sect-h anim-in"><h2>Cash reconciliation</h2></div>
      <div className="card">
        <div className="review-line"><span>Opening float</span><span className="mono">{kes(openingFloatKes)}</span></div>
        <div className="review-line"><span>Expected in drawer</span><span className="mono">{kes(expectedCashKes)}</span></div>
        <div className="review-line"><span>Counted at close</span><span className="mono">{countedCashKes === null ? '— not closed yet' : kes(countedCashKes)}</span></div>
        <div className="review-line" style={{ fontWeight: 700 }}>
          <span>Variance</span>
          <span className="mono" style={{ color: varianceKes === null ? 'var(--tx-3)' : varianceKes === 0 ? 'var(--green)' : 'var(--red)' }}>
            {varianceKes === null ? '—' : `${varianceKes >= 0 ? '+' : ''}${kes(varianceKes)}`}
          </span>
        </div>
      </div>

      <div className="sect-h anim-in"><h2>By payment method</h2></div>
      {paymentSplit.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>No sales in this shift yet.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Method</th><th>Sales</th><th>Total</th></tr></thead>
            <tbody>
              {paymentSplit.map((p) => (
                <tr key={p.method}>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="mono">{p.count}</td>
                  <td className="mono">{kes(p.totalKes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
