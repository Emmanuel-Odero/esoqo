import type { Metadata } from 'next';
import { listMyStores, listAllProductsForOwner } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { ProductForm } from './ProductForm';
import { VisibilityToggle } from './VisibilityToggle';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export default async function ProductsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const products = await listAllProductsForOwner(ctx, store.id);

  return (
    <>
      <div className="dash-top">
        <h1 style={{ fontSize: '1.3rem' }}>Products</h1>
        <ProductForm storeId={store.id} />
      </div>

      {products.length === 0 ? (
        <p style={{ color: 'var(--tx-2)', fontSize: '.88rem' }}>No products yet — add your first one above.</p>
      ) : (
        <div className="pgrid">
          {products.map((p) => (
            <div key={p.id} className="pcard">
              <span className="nm">{p.name}</span>
              <span className="pr">{kes(Number(p.priceKes))}</span>
              <span className="st">{p.stockQty === null ? 'Stock not tracked' : `${p.stockQty} in stock`}</span>
              <div style={{ marginTop: 10 }}>
                <VisibilityToggle productId={p.id} status={p.status as 'ACTIVE' | 'HIDDEN'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
