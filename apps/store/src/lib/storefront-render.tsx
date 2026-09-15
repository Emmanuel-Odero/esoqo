import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStoreBySlug } from '@esoqo/db';
import { getCtx } from '@/lib/session';
import { StorefrontClient } from '@/app/s/[slug]/StorefrontClient';

/**
 * Shared between the two public storefront address shapes —
 * `/s/[slug]` (the internal canonical route) and `/[handle]` (serves
 * the free `/@slug` form as a real file-system route, since a proxy.ts
 * rewrite from `/@slug` reliably fails to resolve: Next.js treats a
 * leading `@` as reserved parallel-route syntax even in a rewrite
 * target's *source* path, well before file-system routing sees it).
 */

export async function storefrontMetadata(slug: string): Promise<Metadata> {
  const ctx = await getCtx();
  const store = await getStoreBySlug(ctx, slug);
  return {
    title: store?.name ?? 'Store not found',
    description: store?.tagline ?? store?.aboutUs?.slice(0, 160) ?? undefined,
    ...(store?.faviconUrl ? { icons: { icon: store.faviconUrl } } : {}),
  };
}

export async function StorefrontBySlug({ slug }: { slug: string }) {
  const ctx = await getCtx();
  const store = await getStoreBySlug(ctx, slug);
  if (!store) notFound();

  const products = store.products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    priceKes: Number(p.priceKes),
    stockQty: p.stockQty,
    availableOnOrder: p.availableOnOrder,
    imageUrl: p.images[0]?.url ?? null,
    variants: p.variants.map((v) => ({
      id: v.id, label: v.label, priceKes: Number(v.priceKes), stockQty: v.stockQty,
      availableOnOrder: v.availableOnOrder,
    })),
  }));
  const fulfilmentOptions = store.fulfilmentOptions.map((f) => ({
    id: f.id, kind: f.kind as 'PICKUP' | 'DELIVERY', label: f.label, feeKes: Number(f.feeKes),
  }));

  const socials: { key: string; handle: string }[] =
    ([['instagram', store.instagram], ['facebook', store.facebook], ['tiktok', store.tiktok], ['whatsapp', store.whatsapp], ['linkedin', store.linkedin]] as const)
      .filter(([, handle]) => handle)
      .map(([key, handle]) => ({ key, handle: handle as string }));

  return (
    <StorefrontClient
      store={{
        slug: store.slug,
        name: store.name,
        themeKey: store.themeKey,
        tagline: store.tagline,
        aboutUs: store.aboutUs,
        brandAccent: store.brandAccent,
        contactPerson: store.contactPerson,
        contactEmail: store.contactEmail,
        contactPhone: store.contactPhone,
        physicalAddress: store.physicalAddress,
        deliveryOrigin: store.deliveryOrigin,
        deliveryZones: store.deliveryZones,
        processingDays: store.processingDays,
        currency: store.currency,
        settlementPhone: store.settlementPhone,
        codEnabled: store.codEnabled,
        verified: store.enterprise?.isRegistered ?? false,
        county: store.enterprise?.party.county ?? null,
        legalName: store.legalName,
        registrationNumber: store.registrationNumber,
        logoUrl: store.logoUrl,
        photos: store.photos.map((p) => p.url),
        socials,
      }}
      products={products}
      fulfilmentOptions={fulfilmentOptions}
    />
  );
}
