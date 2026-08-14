import type { BusinessTypeKey } from './registration';

/**
 * The business-type picker on /join's business path. Same shape as
 * counties.ts: a small hand-curated list, not an enum-label lookup,
 * because each one carries a plain-language blurb a first-time
 * registrant can actually judge themselves against.
 *
 * `key` must stay in sync with businessTypeKeySchema in registration.ts.
 */
export interface BusinessType {
  key: BusinessTypeKey;
  label: string;
  /** Five words or so — enough to tell them apart, not a legal definition. */
  blurb: string;
}

export const BUSINESS_TYPES: BusinessType[] = [
  { key: 'SOLE_PROPRIETORSHIP', label: 'Sole proprietorship', blurb: 'One owner, unlimited personal liability' },
  { key: 'PARTNERSHIP', label: 'Partnership', blurb: 'Two or more owners share it' },
  { key: 'LIMITED_COMPANY', label: 'Limited company', blurb: 'Registered entity, liability limited by law' },
  { key: 'COOPERATIVE', label: 'Cooperative', blurb: 'Member-owned, profits shared among members' },
  { key: 'SELF_HELP_ENTERPRISE', label: 'Self-help group enterprise', blurb: 'Group-run income activity, informal structure' },
  { key: 'OTHER', label: 'Other', blurb: 'Something else — tell us what' },
];
