import type { JamiiBlockType } from '@esoqo/db';
import { StatsTickerBlock } from './StatsTickerBlock';
import { ExploreGridBlock } from './ExploreGridBlock';
import { ActiveCampaignBlock } from './ActiveCampaignBlock';
import { DonateBandBlock } from './DonateBandBlock';
import { RichTextBlock } from './RichTextBlock';
import { TestimonialBlock } from './TestimonialBlock';
import { PhotoStripBlock } from './PhotoStripBlock';
import { HeroBlock } from './HeroBlock';
import { CtaButtonBlock } from './CtaButtonBlock';
import { ImageTextBlock } from './ImageTextBlock';
import { VideoEmbedBlock } from './VideoEmbedBlock';
import { MapEmbedBlock } from './MapEmbedBlock';
import { ColumnsBlock } from './ColumnsBlock';
import { SpacerBlock } from './SpacerBlock';
import { ProgramsListBlock } from './ProgramsListBlock';
import { TeamGridBlock } from './TeamGridBlock';
import { GalleryGridBlock } from './GalleryGridBlock';
import { FaqAccordionBlock } from './FaqAccordionBlock';
import { ContactFormBlock } from './ContactFormBlock';
import type { BlockProps, OrgPage } from './types';
import type { OrgLinkMode } from '@/lib/org-links-shared';

export interface HomeBlock {
  id: string;
  type: JamiiBlockType;
  data: unknown;
}

/** One switch, one place — dispatches a JamiiPageBlock row to its
 *  visual component. `data`'s actual shape is validated server-side at
 *  write time by jamiiBlockDataSchema (@esoqo/domain); this only casts
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
    case 'HERO': return <HeroBlock {...props} />;
    case 'CTA_BUTTON': return <CtaButtonBlock {...props} />;
    case 'IMAGE_TEXT': return <ImageTextBlock {...props} />;
    case 'VIDEO_EMBED': return <VideoEmbedBlock {...props} />;
    case 'MAP_EMBED': return <MapEmbedBlock {...props} />;
    case 'COLUMNS': return <ColumnsBlock {...props} />;
    case 'SPACER': return <SpacerBlock {...props} />;
    case 'PROGRAMS_LIST': return <ProgramsListBlock {...props} />;
    case 'TEAM_GRID': return <TeamGridBlock {...props} />;
    case 'GALLERY_GRID': return <GalleryGridBlock {...props} />;
    case 'FAQ_ACCORDION': return <FaqAccordionBlock {...props} />;
    case 'CONTACT_FORM': return <ContactFormBlock {...props} />;
    default: return null;
  }
}
