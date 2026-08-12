import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoko/ui';
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

  const profileComplete = Boolean(store.tagline || store.aboutUs || store.logoUrl || store.legalName);

  return (
    <>
      <div className="dash-top"><h1 style={{ fontSize: '1.3rem' }}>Store settings</h1></div>
      <Link href="/dashboard/settings/profile" className="settings-card profile-cta anim-in" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, textDecoration: 'none' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Store profile</h3>
          <p className="dim" style={{ margin: '4px 0 0', fontSize: '.84rem' }}>
            {profileComplete ? 'Edit your identity, branding, photos, shipping and payments.' : 'Tell your customers who you are — identity, branding, photos, shipping, payments.'}
          </p>
        </div>
        <Icon name="arrow-right" size={18} />
      </Link>
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
