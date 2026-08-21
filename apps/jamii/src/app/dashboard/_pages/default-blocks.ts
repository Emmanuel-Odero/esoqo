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
  { type: 'HERO', label: 'Hero banner', defaultData: { heading: '', subheading: '', imageUrl: '', ctaLabel: '', ctaHref: '' } },
  { type: 'RICH_TEXT', label: 'Rich text', defaultData: { heading: '', html: '' } },
  { type: 'IMAGE_TEXT', label: 'Image + text', defaultData: { heading: '', html: '', imageUrl: '', imagePosition: 'right' } },
  { type: 'COLUMNS', label: 'Columns', defaultData: { heading: '', columns: [{ heading: '', html: '' }, { heading: '', html: '' }] } },
  { type: 'CTA_BUTTON', label: 'Call-to-action button', defaultData: { heading: '', body: '', buttonLabel: '', buttonHref: '' } },
  { type: 'TESTIMONIAL', label: 'Testimonial / quote', defaultData: { quote: '', name: '', role: '' } },
  { type: 'PHOTO_STRIP', label: 'Photo strip', defaultData: { photoIds: [] } },
  { type: 'GALLERY_GRID', label: 'Gallery grid', defaultData: { heading: '' } },
  { type: 'PROGRAMS_LIST', label: 'Programmes list', defaultData: { heading: '' } },
  { type: 'TEAM_GRID', label: 'Team grid', defaultData: { heading: '' } },
  { type: 'FAQ_ACCORDION', label: 'FAQ accordion', defaultData: { heading: '' } },
  { type: 'CONTACT_FORM', label: 'Contact form', defaultData: { heading: '', body: '' } },
  { type: 'VIDEO_EMBED', label: 'Video', defaultData: { heading: '', url: '' } },
  { type: 'MAP_EMBED', label: 'Map', defaultData: { heading: '', embedUrl: '' } },
  { type: 'SPACER', label: 'Spacer', defaultData: { height: 48 } },
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
  HERO: 'Hero banner',
  CTA_BUTTON: 'Call-to-action button',
  IMAGE_TEXT: 'Image + text',
  VIDEO_EMBED: 'Video',
  MAP_EMBED: 'Map',
  COLUMNS: 'Columns',
  SPACER: 'Spacer',
  PROGRAMS_LIST: 'Programmes list',
  TEAM_GRID: 'Team grid',
  GALLERY_GRID: 'Gallery grid',
  FAQ_ACCORDION: 'FAQ accordion',
  CONTACT_FORM: 'Contact form',
};
