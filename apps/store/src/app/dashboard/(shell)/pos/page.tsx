import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listMyStores, listStoreProducts } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { PosClient } from './PosClient';

export const metadata: Metadata = { title: 'PoS terminal' };
export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) redirect('/dashboard/new');
  if (!store.posEnabled) redirect('/dashboard/settings');

  const products = await listStoreProducts(ctx, store.id);

  return (
    <PosClient
      storeId={store.id}
      products={products.map((p) => ({ id: p.id, name: p.name, priceKes: Number(p.priceKes) }))}
    />
  );
}
