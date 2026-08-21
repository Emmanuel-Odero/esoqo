import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import {
  listJamiiPages, getJamiiPageBySlug, listPublishedJamiiCustomPages, listPublishedJamiiCustomPagesForOrg,
} from '@esoko/db';
import { primaryOrigin } from '@/lib/org-links-shared';

export const dynamic = 'force-dynamic';

/** Every route a public org page actually has — see the (site)/o/[slug]
 *  route tree. Kept as one list here rather than re-deriving it, since
 *  adding a public route means adding it to the sitemap too. */
const ORG_ROUTES = ['', 'about', 'programs', 'campaigns', 'posts', 'gallery', 'leadership', 'faq', 'contact'];

/**
 * On a custom domain (middleware.ts sets x-jamii-domain-slug once it's
 * resolved one), the sitemap should only ever list *that* org's own
 * routes at *that* domain's root — a visitor's crawler has no business
 * being told about ourjamii.co.ke or any other org's page. Otherwise,
 * every published org's /o/{slug}/** routes under the primary origin.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const customSlug = h.get('x-jamii-domain-slug');

  if (customSlug) {
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const origin = host ? `${proto}://${host}` : primaryOrigin();
    const entries: MetadataRoute.Sitemap = ORG_ROUTES.map((route) => ({
      url: route ? `${origin}/${route}` : origin,
      changeFrequency: 'weekly',
      priority: route === '' ? 1 : 0.7,
    }));
    // Custom pages (see JamiiSitePage) — an org's own additions beyond
    // the fixed section list above.
    const org = await getJamiiPageBySlug(customSlug);
    if (org) {
      const customPages = await listPublishedJamiiCustomPagesForOrg(org.organisationId);
      for (const cp of customPages) {
        entries.push({ url: `${origin}/${cp.slug}`, changeFrequency: 'weekly', priority: 0.6 });
      }
    }
    return entries;
  }

  const origin = primaryOrigin();
  // listJamiiPages defaults to 50 (the Discover directory's page size) —
  // a sitemap needs every published org, not just the first page.
  const [pages, customPages] = await Promise.all([
    listJamiiPages({ take: 5000 }),
    listPublishedJamiiCustomPages(),
  ]);
  const entries: MetadataRoute.Sitemap = [{ url: origin, changeFrequency: 'daily', priority: 1 }];
  for (const page of pages) {
    for (const route of ORG_ROUTES) {
      entries.push({
        url: `${origin}/o/${page.slug}${route ? `/${route}` : ''}`,
        changeFrequency: 'weekly',
        priority: route === '' ? 0.9 : 0.6,
      });
    }
    for (const campaign of page.campaigns) {
      entries.push({ url: `${origin}/o/${page.slug}/c/${campaign.slug}`, changeFrequency: 'daily', priority: 0.7 });
    }
  }
  for (const cp of customPages) {
    entries.push({ url: `${origin}/o/${cp.page.slug}/${cp.slug}`, changeFrequency: 'weekly', priority: 0.6 });
  }
  return entries;
}
