import Link from 'next/link';
import { listActiveMediaAssets } from '@esoko/db';
import { orgHref, isVerified, type OrgLinkMode } from '@/lib/org-links-shared';
import { pickMediaAsset } from '@/lib/media';
import { splitHeroHeadline } from '@/lib/whitelabel-headline';
import { MediaPlaceholder, PATTERNS, isPatternKey } from './placeholders/patterns';
import type { getJamiiPageBySlug } from '@esoko/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

/**
 * The homepage hero — ported from the template's `.hero`: a big
 * uppercase three-line headline (see splitHeroHeadline) beside a small
 * image/fact panel, with a faint background pattern wash rather than a
 * full-bleed cover photo. Every interior page uses the plain
 * `.wl-page-intro` instead — see OrgPageBanner.
 */
export async function OrgHomeHero({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  const org = page.organisation;
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const [l1, l2, l3] = splitHeroHeadline(page.tagline, org.officialName);

  const bgAssets = await listActiveMediaAssets('HERO');
  const bgAsset = pickMediaAsset(bgAssets, `${page.organisationId}-bg`);
  const BgPattern = bgAsset && isPatternKey(bgAsset.patternKey) ? PATTERNS[bgAsset.patternKey] : null;

  const imgAssets = page.coverUrl ? [] : bgAssets;
  const imgAsset = pickMediaAsset(imgAssets, `${page.organisationId}-img`) ?? bgAsset;

  return (
    <section className="wl-hero">
      {BgPattern && <BgPattern className="wl-hero-pattern" />}
      <div className="wl-hero-fade" />
      <div className="wl-hero-inner">
        <div>
          {isVerified(org) && <span className="wl-verified">Verified organisation</span>}
          <h1 className="wl-hero-headline">
            <span className="l1">{l1}</span>
            {l2 && <span className="l2">{l2}</span>}
            {l3 && <span className="l3">{l3}</span>}
          </h1>
          {page.missionShort && <p className="wl-lede">{page.missionShort}</p>}
          <div className="wl-hero-actions">
            {activeCampaign && (
              <Link href={orgHref(mode, `c/${activeCampaign.slug}`)} className="wl-cta">
                Support our work
              </Link>
            )}
            <Link href={orgHref(mode, 'about')} className="wl-cta-ghost">Read our story</Link>
          </div>
        </div>
        <div className="wl-hero-side">
          <div className="wl-hero-image">
            {page.coverUrl
              ? <img src={page.coverUrl} alt="" />
              : imgAsset && <MediaPlaceholder patternKey={imgAsset.patternKey} />}
          </div>
          {org.tags.length > 0 && (
            <div className="wl-hero-fact">
              <div className="k">Focus areas</div>
              <div className="v">{org.tags.join(' · ')}</div>
            </div>
          )}
          <div className="wl-hero-fact">
            <div className="k">Based in</div>
            <div className="v">{org.party.county}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
