import { redirect } from 'next/navigation';
import { listJamiiNavItemsPublic } from '@esoko/db';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { resolveNavLinks } from '@/lib/org-links-shared';
import { loadOrgOr404 } from '@/components/OrgSectionShell';
import { OrgTopNav } from '@/components/OrgTopNav';
import { OrgHomeHero } from '@/components/OrgHomeHero';
import { OrgHomeSections } from '@/components/OrgHomeSections';
import { OrgFooter } from '@/components/OrgFooter';
import { OrgJsonLd } from '@/components/OrgJsonLd';
import { WhitelabelThemeRoot } from '@/lib/whitelabel-theme';
import { isVerified } from '@/lib/data';
import { orgExternalUrl } from '@/lib/org-external-url';
import { buildOrgMetadata, currentOrigin } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mode = await getOrgLinkMode(slug);
  if (mode.base !== '') return {}; // this route redirects to /about there — no separate metadata needed
  const page = await loadOrgOr404(slug);
  return buildOrgMetadata(page, mode);
}

/**
 * The org's index route. On the primary domain this has always just
 * redirected to /about — the org is one listing among many on
 * ourjamii.co.ke, so there's no separate "homepage" concept there.
 *
 * On a custom domain this route *is* the homepage — a real, distinct
 * landing page (OrgHomeHero + OrgHomeSections), not a redirect. See
 * OrgHomeHero/OrgPageBanner's header comments for how the rest of the
 * site (About, Programmes, ...) inherits this page's theme
 * (WhitelabelThemeRoot, OrgTopNav, OrgFooter) without repeating its hero.
 */
export default async function OrgIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mode = await getOrgLinkMode(slug);

  if (mode.base !== '') {
    redirect(orgHref(mode, 'about'));
  }

  const page = await loadOrgOr404(slug);
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const externalUrl = orgExternalUrl(page);
  // Already on the custom domain — only worth showing here if it's a
  // *different* site (the `website` field), never the domain itself.
  const websiteUrl = externalUrl?.kind === 'website' ? externalUrl : null;
  const origin = await currentOrigin(mode);
  const navLinks = resolveNavLinks(await listJamiiNavItemsPublic(page.organisationId), mode);

  return (
    <WhitelabelThemeRoot
      defaultMode={page.themeDefaultMode}
      brandAccent={page.brandAccent}
      brandAccentTwo={page.brandAccentTwo}
      brandAccentThree={page.brandAccentThree}
    >
      <OrgJsonLd page={page} url={origin} />
      <OrgTopNav
        orgName={page.organisation.officialName}
        logoUrl={page.logoUrl}
        verified={isVerified(page.organisation)}
        mode={mode}
        navLinks={navLinks}
        ctaHref={activeCampaign ? orgHref(mode, `c/${activeCampaign.slug}`) : null}
        ctaLabel="Support us"
        websiteUrl={websiteUrl}
      />
      <OrgHomeHero page={page} mode={mode} />
      <OrgHomeSections page={page} mode={mode} />
      <OrgFooter page={page} mode={mode} />
    </WhitelabelThemeRoot>
  );
}
