import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { getStoreDetailForStaff, getStoreAnalyticsForStaff, listCashiers } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { StoreDetailPanel } from './StoreDetailPanel';
import { CashiersPanel } from './CashiersPanel';
import { DailyBarChart, DonutChart, RankedBarChart } from '@/components/charts';

const DONUT_PALETTE = ['var(--green-2)', 'var(--blue)', 'var(--amber)', 'var(--red)', 'var(--navy-2)'];

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment', PAID: 'Paid', FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT: 'var(--amber)', PAID: 'var(--blue)', FULFILLED: 'var(--green)', CANCELLED: 'var(--red)',
};

export default async function StoreDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('store.moderate');
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('store.write');
  const canManageCashiers = ctx.capabilities.includes('*') || ctx.capabilities.includes('cashier.write');

  const [detail, analytics, cashiers] = await Promise.all([
    getStoreDetailForStaff(ctx, id),
    getStoreAnalyticsForStaff(ctx, id),
    canManageCashiers ? listCashiers(ctx, id) : Promise.resolve([]),
  ]);
  if (!detail) {
    return (
      <div className="card">
        <p className="empty">This store could not be found.</p>
      </div>
    );
  }

  const { store, orders, posSales, revenueKes } = detail;
  const {
    dailyRevenue, wowChangePct, statusBreakdown, fulfillmentRatePct,
    paymentSplit, topProducts, uniqueBuyers, repeatBuyers, lowStock, posConflicts,
  } = analytics;

  const owner = store.enterprise.party.person?.knownAs || store.enterprise.party.person?.officialName
    || store.enterprise.party.organisation?.knownAs || store.enterprise.party.organisation?.officialName || '—';
  const ownerContact = store.enterprise.party.person?.msisdn ?? null;


  return (
    <>
      <div className="head">
        <div>
          <Link href="/estores/stores" className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <Icon name="arrow-left" size={14} />Back to stores
          </Link>
          <h1>{store.name}</h1>
          <p>
            {store.enterprise.workRaw}
            {store.enterprise.sector && <> · {store.enterprise.sector}</>}
            {' '}· owned by {owner}{ownerContact && <> ({ownerContact})</>}
          </p>
        </div>
      </div>

      {(lowStock.length > 0 || posConflicts.length > 0) && (
        <div className="grid2" style={{ marginBottom: 22 }}>
          {posConflicts.length > 0 && (
            <p className="pill p-bad" style={{ padding: '12px 15px', whiteSpace: 'normal', alignItems: 'flex-start' }}>
              <Icon name="alert-triangle" size={15} />
              <span>
                <strong>{posConflicts.length} PoS sale{posConflicts.length === 1 ? '' : 's'} unreconciled.</strong>{' '}
                A till sale synced with a conflict the device couldn't resolve on its own — worth walking
                the owner through it before it happens again.
              </span>
            </p>
          )}
          {lowStock.length > 0 && (
            <p className="pill p-warn" style={{ padding: '12px 15px', whiteSpace: 'normal', alignItems: 'flex-start' }}>
              <Icon name="alert-circle" size={15} />
              <span>
                <strong>{lowStock.length} product{lowStock.length === 1 ? '' : 's'} almost out of stock.</strong>{' '}
                {lowStock.slice(0, 3).map((p) => p.name).join(', ')}
                {lowStock.length > 3 && ` and ${lowStock.length - 3} more`} — 5 units or fewer left.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="coins" size={16} /></span>
          <span className="n">KES {revenueKes.toLocaleString('en-KE')}</span>
          <span className="l">Revenue</span>
          {wowChangePct !== null && (
            <span className="sub" style={{ color: wowChangePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              <Icon name={wowChangePct >= 0 ? 'trend-up' : 'trend-down'} size={12} />{' '}
              {wowChangePct >= 0 ? '+' : ''}{wowChangePct}% vs last week
            </span>
          )}
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="basket" size={16} /></span>
          <span className="n">{store._count.orders}</span><span className="l">Online orders</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}><Icon name="keypad" size={16} /></span>
          <span className="n">{store._count.posSales}</span><span className="l">PoS sales</span>
        </div>
        <div className="kpi r">
          <span className="ico" style={{ background: 'var(--red-t)', color: 'var(--red)' }}><Icon name="grid" size={16} /></span>
          <span className="n">{store._count.products}</span><span className="l">Products</span>
        </div>
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="users" size={16} /></span>
          <span className="n">{uniqueBuyers}</span>
          <span className="l">Buyers</span>
          {uniqueBuyers > 0 && (
            <span className="sub">{repeatBuyers} repeat{repeatBuyers === 1 ? '' : 's'}</span>
          )}
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="check-circle" size={16} /></span>
          <span className="n">{fulfillmentRatePct !== null ? `${fulfillmentRatePct}%` : '—'}</span>
          <span className="l">Fulfilment rate</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2><Icon name="trend-up" size={18} />Revenue, last {analytics.windowDays} days</h2>
        <DailyBarChart data={dailyRevenue.map((d) => ({ date: d.date, value: d.revenueKes }))} currency height={170} />
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="basket" size={18} />Order status</h2>
          {store._count.orders === 0 ? (
            <p className="empty">No online orders in this window.</p>
          ) : (
            <DonutChart size={150}
              segments={statusBreakdown.map((s) => ({
                label: STATUS_LABEL[s.status] ?? s.status, value: s.count, color: STATUS_COLOR[s.status] ?? 'var(--tx-3)',
              }))}
              centerLabel={{ value: String(store._count.orders), sub: 'orders' }} />
          )}
        </div>

        <div className="card">
          <h2><Icon name="coins" size={18} />How people pay</h2>
          {paymentSplit.length === 0 ? (
            <p className="empty">No sales in this window yet.</p>
          ) : (
            <DonutChart size={150}
              segments={paymentSplit.map((p, i) => ({ label: p.label, value: p.count, color: DONUT_PALETTE[i % DONUT_PALETTE.length]! }))} />
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2><Icon name="star" size={18} />Top products, last {analytics.windowDays} days</h2>
        {topProducts.length === 0 ? (
          <p className="empty">Nothing sold in this window yet.</p>
        ) : (
          <RankedBarChart color="var(--blue)" currency
            rows={topProducts.map((p) => ({ label: p.name, value: p.revenueKes }))} />
        )}
      </div>

      <StoreDetailPanel
        store={{
          id: store.id, name: store.name, slug: store.slug, status: store.status,
          routingMode: store.routingMode, posEnabled: store.posEnabled, themeKey: store.themeKey,
        }}
        canEdit={canEdit}
        canModerate={canModerate}
      />

      {canManageCashiers && (
        <CashiersPanel
          storeId={store.id}
          cashiers={cashiers.map((c) => ({ id: c.id, name: c.name, role: c.role, active: c.active }))}
        />
      )}

      <div className="grid2" style={{ marginTop: 22 }}>
        <div className="card">
          <h2><Icon name="basket" size={18} />Recent orders</h2>
          {orders.length === 0 ? (
            <p className="empty">No online orders yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th><th>When</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.buyerName}<span className="sub" style={{ display: 'block', fontSize: '.79rem' }}>{o.buyerMsisdn}</span></td>
                    <td className="sub">{o.items.length} item{o.items.length === 1 ? '' : 's'}</td>
                    <td className="mono">KES {Number(o.totalKes).toLocaleString('en-KE')}</td>
                    <td><span className="pill p-mute">{o.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="mono sub" style={{ fontSize: '.79rem' }}>{o.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2><Icon name="keypad" size={18} />Recent PoS sales</h2>
          {posSales.length === 0 ? (
            <p className="empty">No till sales recorded yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Items</th><th>Total</th><th>Method</th><th>Sync</th><th>When</th></tr></thead>
              <tbody>
                {posSales.map((s) => (
                  <tr key={s.id}>
                    <td className="sub">{s.items.length} item{s.items.length === 1 ? '' : 's'}</td>
                    <td className="mono">KES {Number(s.totalKes).toLocaleString('en-KE')}</td>
                    <td className="sub">{s.paymentMethod === 'MPESA_TILL' ? 'M-Pesa till' : 'Cash'}</td>
                    <td>
                      <span className={`pill ${s.syncStatus === 'CONFLICT' ? 'p-bad' : s.syncStatus === 'PENDING' ? 'p-warn' : 'p-ok'}`}>
                        {s.syncStatus.toLowerCase()}
                      </span>
                    </td>
                    <td className="mono sub" style={{ fontSize: '.79rem' }}>{s.soldAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h2><Icon name="grid" size={18} />Products</h2>
        {store.products.length === 0 ? (
          <p className="empty">This store has no products listed yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
            <tbody>
              {store.products.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td className="mono">KES {Number(p.priceKes).toLocaleString('en-KE')}</td>
                  <td className="mono sub">{p.stockQty ?? '—'}</td>
                  <td>
                    <span className={`pill ${p.status === 'ACTIVE' ? 'p-ok' : 'p-mute'}`}>
                      {p.status === 'ACTIVE' ? 'Visible' : 'Hidden'}
                    </span>
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
