import { absoluteAssetUrl } from '@/lib/seo';

/**
 * schema.org NGO/Organization structured data — rendered once per org
 * page (OrgSectionShell for every section route, plus the custom-domain
 * homepage which doesn't go through OrgSectionShell). See
 * buildOrgMetadata (apps/jamii/src/lib/seo.ts) for the <title>/OG side
 * of SEO; this is the separate structured-data side search engines use
 * for rich results.
 */
export interface OrgJsonLdPage {
  organisation: {
    officialName: string;
    party: { county: string; ward: string | null };
  };
  slug: string;
  missionShort: string | null;
  tagline: string | null;
  logoUrl: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  whatsapp: string | null;
}

function absolutise(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function OrgJsonLd({ page, url }: { page: OrgJsonLdPage; url: string }) {
  const origin = new URL(url).origin;
  const sameAs = [page.website, page.facebook, page.instagram, page.twitter, page.whatsapp]
    .filter((v): v is string => Boolean(v?.trim()))
    .map(absolutise);

  const data = {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    name: page.organisation.officialName,
    url,
    ...(page.logoUrl ? { logo: absoluteAssetUrl(page.logoUrl, origin) } : {}),
    ...(page.missionShort || page.tagline ? { description: page.missionShort || page.tagline } : {}),
    address: {
      '@type': 'PostalAddress',
      addressRegion: page.organisation.party.county,
      ...(page.organisation.party.ward ? { addressLocality: page.organisation.party.ward } : {}),
      addressCountry: 'KE',
    },
    ...(sameAs.length ? { sameAs } : {}),
  };

  return (
    <script
      type="application/ld+json"
      // Escapes "<" so a field value containing "</script>" (e.g. a
      // malicious `website` URL) can't break out of this tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
