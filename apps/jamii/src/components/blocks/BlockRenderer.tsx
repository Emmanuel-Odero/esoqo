import type { JamiiBlockType } from '@esoko/db';
import { StatsTickerBlock } from './StatsTickerBlock';
import { ExploreGridBlock } from './ExploreGridBlock';
import { ActiveCampaignBlock } from './ActiveCampaignBlock';
import { DonateBandBlock } from './DonateBandBlock';
import { RichTextBlock } from './RichTextBlock';
import { TestimonialBlock } from './TestimonialBlock';
import { PhotoStripBlock } from './PhotoStripBlock';
import type { BlockProps, OrgPage } from './types';
import type { OrgLinkMode } from '@/lib/org-links-shared';

export interface HomeBlock {
  id: string;
  type: JamiiBlockType;
  data: unknown;
}

/** One switch, one place — dispatches a JamiiPageBlock row to its
 *  visual component. `data`'s actual shape is validated server-side at
 *  write time by jamiiBlockDataSchema (@esoko/domain); this only casts
 *  it back to the matching shape per `type`, same trust boundary every
 *  other already-persisted-and-trusted read in this app relies on. */
export function BlockRenderer({ block, page, mode }: { block: HomeBlock; page: OrgPage; mode: OrgLinkMode }) {
  const props = { page, mode, data: block.data } as BlockProps<never>;
  switch (block.type) {
    case 'STATS_TICKER': return <StatsTickerBlock {...props} />;
    case 'EXPLORE_GRID': return <ExploreGridBlock {...props} />;
    case 'ACTIVE_CAMPAIGN': return <ActiveCampaignBlock {...props} />;
    case 'DONATE_BAND': return <DonateBandBlock {...props} />;
    case 'RICH_TEXT': return <RichTextBlock {...props} />;
    case 'TESTIMONIAL': return <TestimonialBlock {...props} />;
    case 'PHOTO_STRIP': return <PhotoStripBlock {...props} />;
    default: return null;
  }
}
