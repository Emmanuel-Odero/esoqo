import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoko/ui';
import { getEstoreOverview } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { RevenueTrendChart } from './RevenueTrendChart';

export const dynamic = 'force-dynamic';

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Live', DRAFT: 'Draft', SUSPENDED: 'Suspended' };
const STATUS_COLOR: Record<string, string> = { ACTIVE: 'var(--green)', DRAFT: 'var(--amber)', SUSPENDED: 'var(--red)' };

export default async function EstoresOverviewPage() {
  const ctx = await requireStaff();
  const o = await getEstoreOverview(ctx);

  const maxStatus = Math.max(1, ...o.statusBreakdown.map((s) => s.count));
  const maxSector = Math.max(1, ...o.sectorBreakdown.map((s) => s.count));
  const maxStoreRevenue = Math.max(1, ...o.topStores.map((s) => s.revenueKes));

  return (
    <>
      <div className="head">
        <div>
          <h1>eStores overview</h1>
          <p>
            The whole marketplace at a glance — every store's online and till sales combined.
            Open a store from the leaderboard below for its full performance and settings.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="coins" size={16} /></span>
          <span className="n">KES {o.gmvKes.toLocaleString('en-KE')}</span>
          <span className="l">Gross sales, {o.windowDays}d</span>
          {o.wowChangePct !== null && (
            <span className="sub" style={{ color: o.wowChangePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              <Icon name={o.wowChangePct >= 0 ? 'trend-up' : 'trend-down'} size={12} />{' '}
              {o.wowChangePct >= 0 ? '+' : ''}{o.wowChangePct}% vs last week
            </span>
          )}
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="bank" size={16} /></span>
          <span className="n">KES {o.commissionEarnedKes.toLocaleString('en-KE')}</span>
          <span className="l">Platform earnings, {o.windowDays}d</span>
          <span className="sub">at {o.platformFeePct}% platform fee</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="basket" size={16} /></span>
          <span className="n">{o.ordersThisWindow}</span><span className="l">Orders, {o.windowDays}d</span>
        </div>
        <div className="kpi r">
          <span className="ico" style={{ background: 'var(--red-t)', color: 'var(--red)' }}><Icon name="shop" size={16} /></span>
          <span className="n">{o.totalStores}</span>
          <span className="l">Total stores</span>
          {o.newStores > 0 && <span className="sub">{o.newStores} new this window</span>}
        </div>
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="keypad" size={16} /></span>
          <span className="n">{o.posAdoptionPct}%</span>
          <span className="l">PoS adoption</span>
          <span className="sub">{o.posEnabledCount} of {o.totalStores} stores</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2><Icon name="trend-up" size={18} />Marketplace revenue, last {o.windowDays} days</h2>
        <RevenueTrendChart data={o.dailyRevenue} />
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="shop" size={18} />Store status</h2>
          <table className="tbl">
            <tbody>
              {o.statusBreakdown.map((s) => (
                <tr key={s.status}>
                  <td>{STATUS_LABEL[s.status]}</td>
                  <td className="mono" style={{ width: 40 }}>{s.count}</td>
                  <td style={{ width: '55%' }}>
                    <div className="bar">
                      <span style={{ width: `${(s.count / maxStatus) * 100}%`, background: STATUS_COLOR[s.status] }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2><Icon name="grid" size={18} />What's being sold</h2>
          {o.sectorBreakdown.length === 0 ? (
            <p className="empty">No stores with a recorded sector yet.</p>
          ) : (
            <table className="tbl">
              <tbody>
                {o.sectorBreakdown.map((s) => (
                  <tr key={s.sector}>
                    <td>{s.sector}</td>
                    <td className="mono" style={{ width: 40 }}>{s.count}</td>
                    <td style={{ width: '55%' }}>
                      <div className="bar"><span style={{ width: `${(s.count / maxSector) * 100}%`, background: 'var(--blue)' }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2><Icon name="star" size={18} />Top stores, last {o.windowDays} days</h2>
        {o.topStores.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="shop" size={22} /></span>
            <h3>No sales yet in this window</h3>
            <p style={{ margin: 0 }}>Once a store starts selling, the busiest ones show up here.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Store</th><th>Owner</th><th>Status</th><th>Revenue</th><th /></tr></thead>
            <tbody>
              {o.topStores.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="sub">{s.owner}</td>
                  <td><span className={`pill ${STATUS_PILL[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
                  <td>
                    <span className="mono">KES {s.revenueKes.toLocaleString('en-KE')}</span>
                    <div className="bar" style={{ marginTop: 4 }}>
                      <span style={{ width: `${(s.revenueKes / maxStoreRevenue) * 100}%` }} />
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn btn-o btn-sm" href={`/estores/stores/${s.id}` as Route}>
                      <Icon name="eye" size={13} />View
                    </Link>
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
