import type { Metadata } from 'next';
import { listMyStores, listStoreOrders } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { FulfilButton } from './FulfilButton';
import { CollectCodButton } from './CollectCodButton';
import { Icon } from '@esoko/ui';

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
      <div className="dash-top anim-in">
        <div>
          <h1>Orders</h1>
          <p className="sub">{orders.length} order{orders.length !== 1 ? 's' : ''} total</p>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="basket" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No orders yet.</p>
        </div>
      ) : (
        <div className="card tbl-wrap" style={{ padding: 0 }}>
          <table className="dtbl">
            <thead><tr><th>Order</th><th>Buyer</th><th>Phone</th><th>Items</th><th>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">#{o.id.slice(0, 8)}</td>
                  <td>{o.buyerName}{o.deliveryAddress && <span className="mono" style={{ display: 'block', fontSize: '.76rem', color: 'var(--tx-3)', marginTop: 2 }}>{o.deliveryAddress}</span>}</td>
                  <td className="mono">{o.buyerMsisdn}</td>
                  <td>{o.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')}</td>
                  <td className="mono">{kes(Number(o.totalKes))}<span style={{ display: 'block', fontSize: '.76rem', color: 'var(--tx-3)', marginTop: 2 }}>{o.paymentMethod === 'CASH_ON_DELIVERY' ? 'Cash on delivery' : 'M-Pesa'}</span></td>
                  <td>
                    <span className={`pill ${o.status === 'FULFILLED' ? 'live' : o.status === 'CANCELLED' ? 'paused' : 'draft'}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td>
                    {o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'CASH_ON_DELIVERY' && <CollectCodButton orderId={o.id} />}
                    {o.status === 'PAID' && <FulfilButton orderId={o.id} />}
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