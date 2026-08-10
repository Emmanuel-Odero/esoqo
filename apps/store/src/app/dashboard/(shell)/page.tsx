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
  if (!store) return null;

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
  const activeProducts = products.filter((p) => p.status === 'ACTIVE').length;
  const totalProducts = products.length;

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Overview</h1>
          <p className="sub">{store.name} · <span className="pill ${store.status === 'ACTIVE' ? 'live' : store.status === 'SUSPENDED' ? 'paused' : 'draft'}">
            <Icon name={store.status === 'ACTIVE' ? 'check-circle' : 'alert-triangle'} size={12} />
            {store.status === 'ACTIVE' ? 'Store live' : store.status === 'SUSPENDED' ? 'Suspended' : 'Draft'}
          </span></p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi anim-in anim-in-d1">
          <span className="icon g"><Icon name="coins" size={18} /></span>
          <div><span className="n">{kes(salesToday)}</span><span className="l">Sales today</span><span className="l">{todayOrders.length + todayPos.length} orders</span></div>
        </div>
        <div className="kpi anim-in anim-in-d2">
          <span className="icon b"><Icon name="basket" size={18} /></span>
          <div><span className="n">{pendingCount}</span><span className="l">Awaiting fulfilment</span></div>
        </div>
        <div className="kpi anim-in anim-in-d3">
          <span className="icon a"><Icon name="box" size={18} /></span>
          <div><span className="n">{activeProducts}</span><span className="l">Products live</span><span className="l">{totalProducts} total</span></div>
        </div>
      </div>

      <div className="sect-h anim-in anim-in-d2"><h2>Recent orders</h2></div>
      {orders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Icon name="basket" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No orders yet — share your storefront link to get your first one.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
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
        </div>
      )}
    </>
  );
}