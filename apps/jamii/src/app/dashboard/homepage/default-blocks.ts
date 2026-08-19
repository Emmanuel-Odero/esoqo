import type { JamiiBlockType } from '@esoko/db';

export interface EditableBlock {
  id?: string;
  type: JamiiBlockType;
  visible: boolean;
  data: Record<string, unknown>;
}

/** The client-side starting state when a page has zero JamiiPageBlock
 *  rows — mirrors DefaultHomeSections' fixed order exactly, so an org
 *  opening this editor for the first time sees something that looks
 *  like their current live homepage, not a blank page. Nothing is
 *  written to the DB until they hit Save. */
export const DEFAULT_BLOCKS: EditableBlock[] = [
  { type: 'STATS_TICKER', visible: true, data: {} },
  { type: 'EXPLORE_GRID', visible: true, data: {} },
  { type: 'ACTIVE_CAMPAIGN', visible: true, data: {} },
  { type: 'DONATE_BAND', visible: true, data: {} },
];

export const ADDABLE_TYPES: { type: JamiiBlockType; label: string; defaultData: Record<string, unknown> }[] = [
  { type: 'RICH_TEXT', label: 'Rich text', defaultData: { heading: '', html: '' } },
  { type: 'TESTIMONIAL', label: 'Testimonial / quote', defaultData: { quote: '', name: '', role: '' } },
  { type: 'PHOTO_STRIP', label: 'Photo strip', defaultData: { photoIds: [] } },
  { type: 'DONATE_BAND', label: 'Donate / partner band', defaultData: {} },
];

export const BLOCK_LABEL: Record<JamiiBlockType, string> = {
  STATS_TICKER: 'Impact stats',
  EXPLORE_GRID: 'Explore grid',
  ACTIVE_CAMPAIGN: 'Active campaign',
  DONATE_BAND: 'Donate / partner band',
  RICH_TEXT: 'Rich text',
  TESTIMONIAL: 'Testimonial / quote',
  PHOTO_STRIP: 'Photo strip',
};
