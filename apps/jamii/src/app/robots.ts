import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { primaryOrigin } from '@/lib/org-links-shared';

export const dynamic = 'force-dynamic';

/**
 * /dashboard, /signin and /start are middleware.ts-only reachable on
 * the primary domain (a custom-domain request never resolves outside
 * /o/{slug}/**, see middleware.ts) — disallowed under both anyway, so
 * this file doesn't need to special-case which domain served it.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const origin = host ? `${proto}://${host}` : primaryOrigin();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/signin', '/start', '/apply'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
