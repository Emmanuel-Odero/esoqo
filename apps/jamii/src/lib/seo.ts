import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { primaryOrigin, type OrgLinkMode } from './org-links-shared';

/**
 * One place building an org page's <title>/description/OG/Twitter
 * metadata — used by every generateMetadata() under (site)/o/[slug]/**
 * so title/description derivation logic (seoTitle/seoDescription
 * override, else missionShort/tagline, see JamiiPage's seoTitle/
 * seoDescription columns) only exists once.
 */
export interface OrgMetaPage {
  organisation: { officialName: string };
  slug: string;
  missionShort: string | null;
  tagline: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
}

/** Absolute origin for the *current* request — the org's own custom
 *  domain when reached that way (see getOrgLinkMode's header comment;
 *  x-forwarded-host is what middleware.ts's rewrite leaves the real
 *  Host in), else the primary ourjamii.co.ke origin. Needed because a
 *  canonical URL/og:url must be a real absolute address, and which
 *  domain that is varies per request, not per build. */
export async function currentOrigin(mode: OrgLinkMode): Promise<string> {
  if (mode.base !== '') return primaryOrigin();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : primaryOrigin();
}

/** R2-stored images (AssetUpload) come back as relative /img/... paths
 *  — fine for <img src>, but og:image/JSON-LD's `logo` need a real
 *  absolute URL for external crawlers to fetch them at all. */
export function absoluteAssetUrl(url: string, origin: string): string {
  return /^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

export async function buildOrgMetadata(
  page: OrgMetaPage,
  mode: OrgLinkMode,
  opts: { path?: string; titleSuffix?: string } = {},
): Promise<Metadata> {
  const title = page.seoTitle?.trim() || (opts.titleSuffix
    ? `${page.organisation.officialName} — ${opts.titleSuffix}`
    : page.organisation.officialName);
  const description = page.seoDescription?.trim() || page.missionShort?.trim() || page.tagline?.trim()
    || `${page.organisation.officialName} — a community organisation on Our Jamii.`;

  const origin = await currentOrigin(mode);
  const rawImage = page.coverUrl || page.logoUrl || undefined;
  const image = rawImage ? absoluteAssetUrl(rawImage, origin) : undefined;
  const path = opts.path ? `/${opts.path.replace(/^\/+/, '')}` : '';
  const canonical = mode.base === '' ? `${origin}${path}` : `${origin}/o/${page.slug}${path}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title, description, url: canonical, type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title, description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
