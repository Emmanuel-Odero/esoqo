import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStoreBySlug } from '@esoko/db';
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
  return { title: store?.name ?? 'Store not found' };
}

export async function StorefrontBySlug({ slug }: { slug: string }) {
  const ctx = await getCtx();
  const store = await getStoreBySlug(ctx, slug);
  if (!store) notFound();

  const products = store.products.map((p) => ({
    id: p.id,
    name: p.name,
    priceKes: Number(p.priceKes),
    stockQty: p.stockQty,
  }));

  return (
    <StorefrontClient
      store={{ slug: store.slug, name: store.name, themeKey: store.themeKey }}
      products={products}
    />
  );
}
