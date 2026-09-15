import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { listMyStores, listAllProductsForOwner } from '@esoqo/db';
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
      <div className="dash-top anim-in">
        <div>
          <h1>Products</h1>
          <p className="sub">{products.length} product{products.length !== 1 ? 's' : ''} listed</p>
        </div>
        <ProductForm storeId={store.id} />
      </div>

      {products.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <Icon name="box" size={28} style={{ color: 'var(--tx-3)', marginBottom: 12 }} />
          <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>No products yet — add your first one above.</p>
        </div>
      ) : (
        <div className="pgrid">
          {products.map((p, i) => (
            <div key={p.id} className="pcard anim-in" style={{ animationDelay: `${i * 0.04}s` }}>
              <span className="badge">
                <span className={`pill ${p.status === 'ACTIVE' ? 'live' : 'draft'}`}>
                  {p.status === 'ACTIVE' ? 'Live' : 'Hidden'}
                </span>
              </span>
              {p.images[0] && (
                <img src={p.images[0].url} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} />
              )}
              <span className="nm">{p.name}</span>
              <span className="pr">{kes(Number(p.priceKes))}</span>
              <span className="st">{p.stockQty === null ? 'Stock not tracked' : `${p.stockQty}${p.purchaseUnit ? ` ${p.purchaseUnit}` : ''} in stock`}{p.variants.length > 0 ? ` · ${p.variants.length} option${p.variants.length === 1 ? '' : 's'}` : ''}</span>
              <div className="row" style={{ marginTop: 12 }}>
                <VisibilityToggle productId={p.id} status={p.status as 'ACTIVE' | 'HIDDEN'} />
                <Link href={`/dashboard/products/${p.id}`} className="btn btn-o btn-sm">Edit</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}