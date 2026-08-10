import type { Metadata } from 'next';
import { listMyStores, listFulfilmentOptions } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { SettingsForm } from './SettingsForm';
import { FulfilmentOptionsManager } from './FulfilmentOptionsManager';

export const metadata: Metadata = { title: 'Store settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const options = await listFulfilmentOptions(ctx, store.id);

  return (
    <>
      <div className="dash-top"><h1 style={{ fontSize: '1.3rem' }}>Store settings</h1></div>
      <SettingsForm
        storeId={store.id}
        initial={{
          name: store.name, themeKey: store.themeKey, posEnabled: store.posEnabled,
          slug: store.slug, routingMode: store.routingMode,
          etimsEnabled: store.etimsEnabled, loyaltyEnabled: store.loyaltyEnabled, loyaltyPerKes: store.loyaltyPerKes,
        }}
      />
      <div className="settings-card anim-in" style={{ marginTop: 18 }}>
        <FulfilmentOptionsManager
          storeId={store.id}
          options={options.map((o) => ({ id: o.id, kind: o.kind, label: o.label, feeKes: Number(o.feeKes), active: o.active }))}
        />
      </div>
    </>
  );
}
