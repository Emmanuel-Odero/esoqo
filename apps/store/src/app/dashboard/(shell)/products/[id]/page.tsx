import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductForOwner } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { ProductEditForm } from './ProductEditForm';
import { ImageManager } from './ImageManager';
import { VariantManager } from './VariantManager';

export const metadata: Metadata = { title: 'Edit product' };
export const dynamic = 'force-dynamic';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSubject();

  let product;
  try {
    product = await getProductForOwner(ctx, id);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="dash-top anim-in">
        <div>
          <h1>{product.name}</h1>
          <p className="sub">Editing this listing</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 18 }}>
        <ProductEditForm product={{
          id: product.id, name: product.name, description: product.description,
          category: product.category, priceKes: Number(product.priceKes),
          costKes: product.costKes !== null ? Number(product.costKes) : null,
          unit: product.unit, purchaseUnit: product.purchaseUnit, stockQty: product.stockQty,
        }} />
        <ImageManager
          productId={product.id}
          images={product.images.map((img) => ({ id: img.id, url: img.url, position: img.position }))}
        />
        <VariantManager
          productId={product.id}
          variants={product.variants.map((v) => ({
            id: v.id, label: v.label, priceKes: Number(v.priceKes),
            costKes: v.costKes !== null ? Number(v.costKes) : null,
            stockQty: v.stockQty, sku: v.sku,
          }))}
        />
      </div>
    </>
  );
}
