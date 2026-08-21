import { getJamiiSitePageByKind, listJamiiPageBlocksPublic } from '@esoko/db';
import type { OrgLinkMode } from '@/lib/org-links-shared';
import { StatsTickerBlock } from './blocks/StatsTickerBlock';
import { ExploreGridBlock } from './blocks/ExploreGridBlock';
import { ActiveCampaignBlock } from './blocks/ActiveCampaignBlock';
import { DonateBandBlock } from './blocks/DonateBandBlock';
import { BlockRenderer } from './blocks/BlockRenderer';
import type { OrgPage } from './blocks/types';

/**
 * Everything on the homepage below OrgHomeHero. Phase 2: an org that
 * has saved anything in the dashboard's "Homepage" block editor gets
 * its custom `JamiiPageBlock` order/visibility (see BlockRenderer);
 * every other page — which is every page today — falls through to
 * DefaultHomeSections below, the exact pre-Phase-2 fixed section
 * order, byte-for-byte unchanged. This is the one thing that must
 * never regress: a page with zero blocks looks identical to before.
 */
export async function OrgHomeSections({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  const home = await getJamiiSitePageByKind(page.organisationId, 'SYSTEM_HOME');
  const blocks = home ? await listJamiiPageBlocksPublic(home.id) : [];
  if (blocks.length === 0) return <DefaultHomeSections page={page} mode={mode} />;

  return (
    <>
      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} page={page} mode={mode} />
      ))}
    </>
  );
}

/** The template's own home page structure, ported as-is: an impact
 *  ticker, a teaser grid linking out to the other sections, whichever
 *  campaign is live, and the closing partner/donate band. Each section
 *  below is the exact same component the block-driven path above uses
 *  (StatsTickerBlock etc.) — this is just their pre-Phase-2 fixed
 *  order and default (empty) data, not a second copy of the JSX. */
function DefaultHomeSections({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  return (
    <>
      <StatsTickerBlock page={page} mode={mode} data={{}} />
      <ExploreGridBlock page={page} mode={mode} data={{}} />
      <ActiveCampaignBlock page={page} mode={mode} data={{}} />
      <DonateBandBlock page={page} mode={mode} data={{}} />
    </>
  );
}
