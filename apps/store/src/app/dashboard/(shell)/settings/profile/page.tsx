import type { Metadata } from 'next';
import { listMyStores, listStorePhotos } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { StoreProfileEditor } from './StoreProfileEditor';

export const metadata: Metadata = { title: 'Store profile' };
export const dynamic = 'force-dynamic';

export default async function StoreProfilePage() {
  const ctx = await requireSubject();
  const [store] = await listMyStores(ctx);
  if (!store) return null;

  const photos = await listStorePhotos(ctx, store.id);

  return (
    <>
      <div className="dash-top"><h1 style={{ fontSize: '1.3rem' }}>Store profile</h1></div>
      <div className="profile-wrap anim-in">
        <StoreProfileEditor
          storeId={store.id}
          initial={{
            identity: {
              legalName: store.legalName ?? '', registrationNumber: store.registrationNumber ?? '',
              contactPerson: store.contactPerson ?? '', contactEmail: store.contactEmail ?? '',
              contactPhone: store.contactPhone ?? '', physicalAddress: store.physicalAddress ?? '',
            },
            branding: {
              tagline: store.tagline ?? '', aboutUs: store.aboutUs ?? '',
              brandAccent: store.brandAccent ?? '',
              instagram: store.instagram ?? '', facebook: store.facebook ?? '',
              tiktok: store.tiktok ?? '', whatsapp: store.whatsapp ?? '', linkedin: store.linkedin ?? '',
            },
            catalog: {
              primaryCategory: store.primaryCategory ?? '',
              skuCount: store.skuCount,
            },
            shipping: {
              deliveryOrigin: store.deliveryOrigin ?? '',
              deliveryZones: store.deliveryZones,
              processingDays: store.processingDays,
            },
            payments: {
              currency: store.currency,
              taxRatePct: store.taxRatePct,
              settlementPhone: store.settlementPhone ?? '',
              codEnabled: store.codEnabled,
            },
            assets: {
              logoUrl: store.logoUrl, faviconUrl: store.faviconUrl,
              photos: photos.map((p) => ({ id: p.id, url: p.url })),
            },
          }}
        />
      </div>
    </>
  );
}