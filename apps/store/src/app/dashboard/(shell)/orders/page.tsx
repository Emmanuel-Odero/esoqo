import type { Metadata } from 'next';
import { listMyStores, listStoreOrders } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { FulfilButton } from './FulfilButton';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment', PAID: 'Paid — needs fulfilling', FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled',
};

export default async function OrdersPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const orders = await listStoreOrders(ctx, store.id);

  return (
    <>
      <div className="dash-top"><h1 style={{ fontSize: '1.3rem' }}>Orders</h1></div>
      {orders.length === 0 ? (
        <p style={{ color: 'var(--tx-2)', fontSize: '.88rem' }}>No orders yet.</p>
      ) : (
        <table className="dtbl">
          <thead><tr><th>Order</th><th>Buyer</th><th>Phone</th><th>Items</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">#{o.id.slice(0, 8)}</td>
                <td>{o.buyerName}</td>
                <td className="mono">{o.buyerMsisdn}</td>
                <td>{o.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')}</td>
                <td className="mono">{kes(Number(o.totalKes))}</td>
                <td>
                  <span className={`pill ${o.status === 'FULFILLED' ? 'live' : o.status === 'CANCELLED' ? 'paused' : 'draft'}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </td>
                <td>{o.status === 'PAID' && <FulfilButton orderId={o.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
