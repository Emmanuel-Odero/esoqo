import { redirect } from 'next/navigation';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { loadOrgOr404 } from '@/components/OrgSectionShell';
import { OrgTopNav } from '@/components/OrgTopNav';
import { OrgHomeHero } from '@/components/OrgHomeHero';
import { OrgHomeSections } from '@/components/OrgHomeSections';
import { OrgFooter } from '@/components/OrgFooter';
import { WhitelabelThemeRoot } from '@/lib/whitelabel-theme';
import { isVerified } from '@/lib/data';

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

  return (
    <WhitelabelThemeRoot
      defaultMode={page.themeDefaultMode}
      brandAccent={page.brandAccent}
      brandAccentTwo={page.brandAccentTwo}
      brandAccentThree={page.brandAccentThree}
    >
      <OrgTopNav
        orgName={page.organisation.officialName}
        logoUrl={page.logoUrl}
        verified={isVerified(page.organisation)}
        mode={mode}
        ctaHref={activeCampaign ? orgHref(mode, `c/${activeCampaign.slug}`) : null}
        ctaLabel="Support us"
      />
      <OrgHomeHero page={page} mode={mode} />
      <OrgHomeSections page={page} mode={mode} />
      <OrgFooter page={page} mode={mode} />
    </WhitelabelThemeRoot>
  );
}
