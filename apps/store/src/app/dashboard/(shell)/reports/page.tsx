import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { listMyStores, getMerchantProfitReport } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { ProfitTrendChart } from './ProfitTrendChart';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export default async function ReportsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const report = await getMerchantProfitReport(ctx, store.id, 30);
  const hasSales = report.dailyProfit.some((d) => d.revenueKes > 0);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Reports</h1>
          <p className="sub">Last {report.windowDays} days — what you sold, what it cost you, and what's actually left over.</p>
        </div>
      </div>

      {!hasSales ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="chart" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No sales in this window yet — ring up a sale or two and this fills in.</p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi anim-in anim-in-d1">
              <span className="icon g"><Icon name="coins" size={18} /></span>
              <div><span className="n">{kes(report.totalProfitKes)}</span><span className="l">Gross profit</span>
                {report.grossMarginPct !== null && <span className="l">{report.grossMarginPct}% margin</span>}
              </div>
            </div>
            <div className="kpi anim-in anim-in-d2">
              <span className="icon b"><Icon name="chart" size={18} /></span>
              <div><span className="n">{kes(report.totalRevenueKes)}</span><span className="l">Revenue</span></div>
            </div>
            <div className="kpi anim-in anim-in-d3">
              <span className="icon a"><Icon name="truck" size={18} /></span>
              <div><span className="n">{kes(report.totalCostKes)}</span><span className="l">Cost of goods</span></div>
            </div>
          </div>

          {report.costTrackedPct < 100 && (
            <div className="n-amber" style={{ padding: '10px 14px', borderRadius: 8, fontSize: '.82rem', margin: '16px 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="info" size={14} style={{ marginTop: 2, flex: 'none' }} />
              <span>
                Only {report.costTrackedPct}% of what sold has a recorded cost — the rest counted as KES 0 cost here,
                so profit is understated. Record deliveries on the <a href="/dashboard/stock" style={{ textDecoration: 'underline' }}>Stock &amp; suppliers</a> page to fill this in.
              </span>
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <ProfitTrendChart data={report.dailyProfit} />
          </div>

          <div className="sect-h anim-in"><h2>Best sellers</h2></div>
          <ReportTable
            rows={report.bestSellers}
            columns={[
              ['name', 'Product'],
              ['unitsSold', 'Units sold'],
              ['revenueKes', 'Revenue'],
              ['profitKes', 'Profit'],
            ]}
          />

          <div className="sect-h anim-in"><h2>Most profitable</h2></div>
          <ReportTable
            rows={report.mostProfitable}
            columns={[
              ['name', 'Product'],
              ['unitsSold', 'Units sold'],
              ['profitKes', 'Profit'],
              ['marginPct', 'Margin'],
            ]}
          />

          {report.leastProfitable.length > 0 && (
            <>
              <div className="sect-h anim-in"><h2>Worth a second look</h2></div>
              <ReportTable
                rows={report.leastProfitable}
                columns={[
                  ['name', 'Product'],
                  ['unitsSold', 'Units sold'],
                  ['profitKes', 'Profit'],
                  ['marginPct', 'Margin'],
                ]}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

type Row = { name: string; unitsSold: number; revenueKes?: number; profitKes: number; marginPct: number | null };

function ReportTable({ rows, columns }: { rows: Row[]; columns: [keyof Row, string][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card tbl-wrap" style={{ padding: 0 }}>
      <table className="dtbl">
        <thead><tr>{columns.map(([key, label]) => <th key={String(key)}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              {columns.map(([key]) => (
                <td key={String(key)} className={key === 'name' ? undefined : 'mono'}>
                  {key === 'revenueKes' || key === 'profitKes' ? kes(Number(r[key] ?? 0))
                    : key === 'marginPct' ? (r.marginPct !== null ? `${r.marginPct}%` : '—')
                    : String(r[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
