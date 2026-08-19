import { notFound } from 'next/navigation';
import { OrgHeader } from './OrgHeader';
import { OrgSubnav } from './OrgSubnav';
import { OrgSidebar } from './OrgSidebar';
import { OrgTopNav } from './OrgTopNav';
import { OrgPageBanner } from './OrgPageBanner';
import { OrgFooter } from './OrgFooter';
import { loadOrgPage, isVerified } from '@/lib/data';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { orgExternalUrl } from '@/lib/org-external-url';
import { WhitelabelThemeRoot } from '@/lib/whitelabel-theme';

export async function loadOrgOr404(slug: string) {
  const page = await loadOrgPage(slug);
  if (!page) notFound();
  return page;
}

export async function OrgSectionShell({
  slug, title, eyebrow, lede, noSidebar = false, children,
}: {
  slug: string; title: string; eyebrow?: string; lede?: string; noSidebar?: boolean; children: React.ReactNode;
}) {
  const page = await loadOrgOr404(slug);
  const mode = await getOrgLinkMode(slug);
  const onCustomDomain = mode.base === '';
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const externalUrl = orgExternalUrl(page);
  // Already on the custom domain — only worth showing here if it's a
  // *different* site (the `website` field), never the domain itself.
  const websiteUrl = externalUrl?.kind === 'website' ? externalUrl : null;

  const body = (
    <>
      {onCustomDomain ? (
        <>
          <OrgTopNav
            orgName={page.organisation.officialName}
            logoUrl={page.logoUrl}
            verified={isVerified(page.organisation)}
            mode={mode}
            ctaHref={activeCampaign ? orgHref(mode, `c/${activeCampaign.slug}`) : null}
            ctaLabel="Support us"
            websiteUrl={websiteUrl}
          />
          <OrgPageBanner eyebrow={eyebrow ?? page.organisation.officialName} title={title} lede={lede} />
        </>
      ) : (
        <>
          <OrgHeader page={page} mode={mode} />
          <OrgSubnav mode={mode} />
        </>
      )}

      {/*
        wl-content: the body content below (About's paragraphs, the
        FAQ accordion, the donate sidebar — all shared verbatim with
        the primary domain's markup/classes) gets restyled by scoped
        CSS overrides in jamii.css rather than new components, so
        ourjamii.co.ke's own rendering of the exact same page.tsx files
        is completely untouched — only presence of this ancestor class
        changes anything.
      */}
      <div className={onCustomDomain ? 'wl-content' : undefined}>
        <div className={`wrap orgtop${noSidebar ? ' nosidebar' : ''}`}>
          <div id="orgPanels">{children}</div>
          {!noSidebar && <OrgSidebar page={page} mode={mode} />}
        </div>
      </div>

      {onCustomDomain && <OrgFooter page={page} mode={mode} />}
    </>
  );

  // Custom-domain visitors get the whitelabelled theme (their own
  // logo/name as the nav, sections as top-level nav, their own colours
  // and appearance toggle, a real footer) — never seen on the primary
  // domain, where OrgHeader/OrgSubnav's directory-listing treatment is
  // correct instead. See OrgTopNav's header comment for the reasoning.
  if (!onCustomDomain) return body;

  return (
    <WhitelabelThemeRoot
      defaultMode={page.themeDefaultMode}
      brandAccent={page.brandAccent}
      brandAccentTwo={page.brandAccentTwo}
      brandAccentThree={page.brandAccentThree}
    >
      {body}
    </WhitelabelThemeRoot>
  );
}
