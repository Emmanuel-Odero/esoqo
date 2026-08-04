import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { listMyStores, listStoreOrders, listPosSales, listAllProductsForOwner } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export default async function DashboardOverview() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null; // layout already redirects — satisfies the type checker

  const [orders, posSales, products] = await Promise.all([
    listStoreOrders(ctx, store.id),
    listPosSales(ctx, store.id, 20),
    listAllProductsForOwner(ctx, store.id),
  ]);

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const todayOrders = orders.filter((o) => o.status !== 'PENDING_PAYMENT' && o.createdAt >= startOfDay);
  const todayPos = posSales.filter((s) => s.soldAt >= startOfDay);
  const salesToday = [...todayOrders, ...todayPos].reduce((sum, r) => sum + Number(r.totalKes), 0);
  const pendingCount = orders.filter((o) => o.status === 'PAID').length;

  return (
    <>
      <div className="dash-top">
        <div>
          <h1 style={{ fontSize: '1.3rem' }}>Overview</h1>
          <p style={{ margin: '2px 0 0', fontSize: '.82rem', color: 'var(--tx-2)' }}>{store.name}</p>
        </div>
        <span className={`pill ${store.status === 'ACTIVE' ? 'live' : store.status === 'SUSPENDED' ? 'paused' : 'draft'}`}>
          <Icon name={store.status === 'ACTIVE' ? 'check-circle' : 'alert-triangle'} size={12} />
          {store.status === 'ACTIVE' ? 'Store live' : store.status === 'SUSPENDED' ? 'Suspended' : 'Draft'}
        </span>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="n">{kes(salesToday)}</span><span className="l">Sales today · {todayOrders.length + todayPos.length} orders</span></div>
        <div className="kpi"><span className="n">{pendingCount}</span><span className="l">Orders awaiting fulfilment</span></div>
        <div className="kpi"><span className="n">{products.filter((p) => p.status === 'ACTIVE').length}</span><span className="l">Products live</span></div>
      </div>

      <div className="sect-h"><h2>Recent orders</h2></div>
      {orders.length === 0 ? (
        <p style={{ color: 'var(--tx-2)', fontSize: '.88rem' }}>No orders yet — share your storefront link to get your first one.</p>
      ) : (
        <table className="dtbl">
          <thead><tr><th>Order</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {orders.slice(0, 8).map((o) => (
              <tr key={o.id}>
                <td className="mono">#{o.id.slice(0, 8)}</td>
                <td>{o.buyerName}</td>
                <td>{o.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')}</td>
                <td className="mono">{kes(Number(o.totalKes))}</td>
                <td>
                  <span className={`pill ${o.status === 'FULFILLED' ? 'live' : o.status === 'PAID' ? 'draft' : o.status === 'CANCELLED' ? 'paused' : 'draft'}`}>
                    {o.status === 'PENDING_PAYMENT' ? 'Awaiting payment' : o.status === 'PAID' ? 'Paid' : o.status === 'FULFILLED' ? 'Fulfilled' : 'Cancelled'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
