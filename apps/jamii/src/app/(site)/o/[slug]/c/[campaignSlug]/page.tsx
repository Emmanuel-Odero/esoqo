import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listJamiiNavItemsPublic } from '@esoqo/db';
import { loadCampaign, loadCampaignExtras, isVerified } from '@/lib/data';
import { getOrgLinkMode, orgHref } from '@/lib/org-links';
import { resolveNavLinks } from '@/lib/org-links-shared';
import { orgExternalUrl } from '@/lib/org-external-url';
import { CampaignLiveProvider, LedgerPanel, SupportersWall } from '@/components/CampaignLiveStats';
import { RichText } from '@/components/RichText';
import { OrgTopNav } from '@/components/OrgTopNav';
import { OrgFooter } from '@/components/OrgFooter';
import { WhitelabelThemeRoot } from '@/lib/whitelabel-theme';
import { buildOrgMetadata, currentOrigin, absoluteAssetUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string; campaignSlug: string }> }) {
  const { slug, campaignSlug } = await params;
  const campaign = await loadCampaign(slug, campaignSlug);
  if (!campaign) return {};
  const mode = await getOrgLinkMode(slug);
  const meta = await buildOrgMetadata(campaign.page, mode, {
    path: `c/${campaignSlug}`, titleSuffix: campaign.title,
  });
  const image = campaign.coverUrl ? absoluteAssetUrl(campaign.coverUrl, await currentOrigin(mode)) : undefined;
  return {
    ...meta,
    description: campaign.summary || meta.description,
    openGraph: { ...meta.openGraph, ...(image ? { images: [{ url: image }] } : {}) },
  };
}

export default async function CampaignPage({
  params,
}: { params: Promise<{ slug: string; campaignSlug: string }> }) {
  const { slug, campaignSlug } = await params;
  const campaign = await loadCampaign(slug, campaignSlug);
  if (!campaign) notFound();

  const mode = await getOrgLinkMode(slug);
  const { stats, donations } = await loadCampaignExtras(campaign.id);
  const goal = Number(campaign.goalKes);
  const org = campaign.page.organisation;
  const daysLeft = campaign.endsAt ? Math.max(0, Math.ceil((campaign.endsAt.getTime() - Date.now()) / 86_400_000)) : null;
  const onCustomDomain = mode.base === '';
  const externalUrl = orgExternalUrl(campaign.page);
  // Already on the custom domain — only worth showing here if it's a
  // *different* site (the `website` field), never the domain itself.
  const websiteUrl = externalUrl?.kind === 'website' ? externalUrl : null;
  const navLinks = onCustomDomain
    ? resolveNavLinks(await listJamiiNavItemsPublic(campaign.page.organisationId), mode)
    : [];

  const body = (
    <>
      {onCustomDomain && (
        <OrgTopNav
          orgName={org.officialName}
          logoUrl={campaign.page.logoUrl}
          verified={isVerified(org)}
          mode={mode}
          navLinks={navLinks}
          ctaHref={null}
          ctaLabel="Support us"
          websiteUrl={websiteUrl}
        />
      )}
      <div className={onCustomDomain ? 'wl-content' : undefined}>
        <div className="campherowrap">
          <div className="wrap">
            <Link href={orgHref(mode)} className="campback">← {org.officialName}</Link>
            <h1>{campaign.title}</h1>
            <p className="campbyline">A campaign by <Link href={orgHref(mode)}>{org.officialName}</Link> · {org.party.county}</p>
            <div className="camp-hero-img">{campaign.coverUrl && <img src={campaign.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
          </div>
        </div>

        <CampaignLiveProvider
          campaignId={campaign.id}
          initial={{
            raisedKes: stats.raisedKes,
            supporters: stats.supporters,
            donations: donations.map((d) => ({
              id: d.id,
              donorName: d.donorName,
              anonymous: d.anonymous,
              amountKes: Number(d.amountKes),
              confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
            })),
          }}
        >
          <div className="wrap camplayout">
            <div>
              <section className="osec">
                <h2>About this project</h2>
                <RichText html={campaign.body} fallback={<p>{campaign.summary}</p>} />
              </section>

              {campaign.updates.length > 0 && (
                <section className="osec">
                  <h2>Updates</h2>
                  {campaign.updates.map((u) => (
                    <div key={u.id} className="card updatecard">
                      <div className="udate">{u.postedAt.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      <h4>{u.title}</h4>
                      <RichText html={u.body} />
                    </div>
                  ))}
                </section>
              )}

              <section className="osec" style={{ marginBottom: 0 }}>
                <h2>Recent supporters</h2>
                <SupportersWall />
              </section>
            </div>

            <LedgerPanel
              campaignId={campaign.id}
              campaignTitle={campaign.title}
              goalKes={goal}
              daysLeft={daysLeft}
              active={campaign.status === 'ACTIVE'}
              verified={isVerified(org)}
            />
          </div>
        </CampaignLiveProvider>
      </div>

      {onCustomDomain && <OrgFooter page={campaign.page} mode={mode} />}
    </>
  );

  if (!onCustomDomain) return body;

  return (
    <WhitelabelThemeRoot
      defaultMode={campaign.page.themeDefaultMode}
      brandAccent={campaign.page.brandAccent}
      brandAccentTwo={campaign.page.brandAccentTwo}
      brandAccentThree={campaign.page.brandAccentThree}
    >
      {body}
    </WhitelabelThemeRoot>
  );
}
