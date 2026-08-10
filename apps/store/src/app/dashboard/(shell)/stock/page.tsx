import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { listMyStores, listAllProductsForOwner, listSuppliers, listStockPurchases } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { SupplierForm } from './SupplierForm';
import { StockPurchaseForm } from './StockPurchaseForm';

export const metadata: Metadata = { title: 'Stock & suppliers' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const dateFmt = (d: Date) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function StockPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const [products, suppliers, purchases] = await Promise.all([
    listAllProductsForOwner(ctx, store.id),
    listSuppliers(ctx, store.id),
    listStockPurchases(ctx, store.id),
  ]);

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>Stock &amp; suppliers</h1>
          <p className="sub">Record what came in, from whom, and at what price — this is what makes your profit numbers real.</p>
        </div>
      </div>

      <div className="stock-grid">
        <div>
          <h3 style={{ fontSize: '.9rem', margin: '0 0 10px' }}>Record a delivery</h3>
          <StockPurchaseForm
            storeId={store.id}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          />

          {purchases.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 20px', marginTop: 18 }}>
              <Icon name="truck" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
              <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No deliveries recorded yet.</p>
            </div>
          ) : (
            <div className="card tbl-wrap" style={{ padding: 0, marginTop: 18 }}>
              <table className="dtbl">
                <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Unit cost</th><th>Total</th><th>Supplier</th></tr></thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td>{dateFmt(p.purchasedAt)}</td>
                      <td>{p.product.name}{p.variant ? ` — ${p.variant.label}` : ''}</td>
                      <td className="mono">{p.quantity}{p.product.purchaseUnit ? ` ${p.product.purchaseUnit}` : ''}</td>
                      <td className="mono">{kes(Number(p.unitCostKes))}</td>
                      <td className="mono">{kes(Number(p.totalCostKes))}</td>
                      <td>{p.supplier?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: '.9rem', margin: '0 0 10px' }}>Suppliers</h3>
          <SupplierForm storeId={store.id} />

          {suppliers.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '32px 16px', marginTop: 14 }}>
              <p style={{ color: 'var(--tx-2)', fontSize: '.85rem', margin: 0 }}>No suppliers yet.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 14, marginTop: 14 }}>
              {suppliers.map((s) => (
                <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '.87rem' }}>{s.name}</div>
                  {s.phone && <div className="mono" style={{ fontSize: '.78rem', color: 'var(--tx-2)' }}>{s.phone}</div>}
                  <div style={{ fontSize: '.76rem', color: 'var(--tx-3)' }}>
                    {s._count.purchases} deliver{s._count.purchases === 1 ? 'y' : 'ies'} on file
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
