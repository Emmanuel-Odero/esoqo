import { ORG_KINDS } from './registration';

/**
 * Plain Our Jamii constants with no zod/jsdom dependency — split out of
 * jamii.ts specifically so CLIENT components (ProgramForm, StartWizard,
 * OrgProfileForm, DiscoverFilters — all 'use client') can import them
 * via '@esoqo/domain/jamii-constants' without also pulling in jamii.ts's
 * `richTextField` (and with it isomorphic-dompurify/jsdom) into the
 * browser bundle. See RichText.tsx's own header for why that matters,
 * and jamii.ts's for the server-side half of this story.
 */

/**
 * Reuses ORG_KINDS from registration.ts — the same group-kind list the
 * join funnel and admin's Groups screen already use, rather than a
 * second, slightly different one. BUSINESS is excluded here the same
 * way JOINABLE_GROUP_KINDS excludes it — Our Jamii is for community
 * groups, not registered businesses.
 */
export const JAMII_ORG_KINDS = ORG_KINDS.filter((k) => k !== 'BUSINESS' && k !== 'SCHOOL' && k !== 'CLINIC');

export const JAMII_ORG_KIND_LABELS: Record<string, string> = {
  CHAMA: 'Chama', SELF_HELP_GROUP: 'Self-help group', TABLE_BANKING: 'Table-banking group',
  WELFARE_GROUP: 'Welfare group', CBO: 'Community-based organisation', FBO: 'Faith-based organisation',
  COOPERATIVE: 'Co-operative', SACCO: 'SACCO', NGO: 'NGO', MARKET_ASSOCIATION: 'Market association',
  OTHER: 'Other',
};

export const JAMII_CAUSES = [
  ['water', 'Water'],
  ['youth', 'Youth'],
  ['enterprise', 'Enterprise'],
  ['agriculture', 'Agriculture'],
  ['education', 'Education'],
  ['health', 'Health'],
] as const;

/**
 * A programme's `icon` is an @esoqo/ui IconName, never free text — see
 * that package's Icon.tsx header: "No emoji anywhere in this product."
 * Duplicated here as a plain string list (not imported from @esoqo/ui,
 * which is a React component package with no business being a
 * dependency of pure validation) rather than the full IconName union;
 * this is the deliberately-curated subset that reads sensibly next to
 * a community programme, not every icon in the 63-glyph set.
 */
export const JAMII_PROGRAM_ICONS = [
  'scales', 'key', 'chart', 'certificate', 'users', 'handshake', 'shield',
  'umbrella', 'leaf', 'wheat', 'building', 'gov', 'bank', 'phone-call',
  'message', 'star',
] as const;
