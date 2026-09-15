import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listMyStores, listStoreProducts, listCashiers, getCashierSelf, getOpenShiftForCashier, assertOwnsStore } from '@esoqo/db';
import { requireStoreAccess } from '@/lib/session';
import { PosClient } from './PosClient';

export const metadata: Metadata = { title: 'PoS terminal' };
export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const access = await requireStoreAccess();

  let storeId: string;
  if (access.kind === 'cashier') {
    storeId = access.ctx.storeId!;
  } else {
    const [ownerStore] = await listMyStores(access.ctx);
    if (!ownerStore) redirect('/dashboard/new');
    storeId = ownerStore.id;
  }

  // One gate for both an owner (SUBJECT) and a cashier (AGENT) — see
  // assertOwnsStore's doc comment in dal/store.ts.
  const store = await assertOwnsStore(access.ctx, storeId, 'pos.sell');

  if (!store.posEnabled) {
    if (access.kind === 'owner') redirect('/dashboard/settings');
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 20px' }}>
        <p style={{ color: 'var(--tx-2)', fontSize: '.88rem', margin: 0 }}>
          The till isn&apos;t turned on for this store yet — ask the owner to enable it in Store settings.
        </p>
      </div>
    );
  }

  const [products, cashiers, signedInCashier] = await Promise.all([
    listStoreProducts(access.ctx, store.id),
    access.kind === 'owner' ? listCashiers(access.ctx, store.id) : Promise.resolve([]),
    access.kind === 'cashier'
      ? Promise.all([getCashierSelf(access.ctx), getOpenShiftForCashier(access.ctx, store.id, access.ctx.actorId!)])
        .then(([self, shift]) => ({ id: self.id, name: self.name, shiftId: shift?.id ?? null }))
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PosClient
        storeId={store.id}
        storeSlug={store.slug}
        products={products.map((p) => ({
          id: p.id, name: p.name, priceKes: Number(p.priceKes),
          stockQty: p.stockQty,
        }))}
        cashiers={cashiers.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        signedInCashier={signedInCashier}
      />
    </>
  );
}
