import { cache } from 'react';
import { getJamiiPageBySlug, getCampaignBySlug, getCampaignStats, listRecentDonations } from '@esoko/db';

/**
 * React's request-scoped cache() so OrgHeader, OrgSubnav and a section's
 * own page.tsx — all independent server components on the same route —
 * share one query instead of three, without any layout coupling between
 * them.
 */
export const loadOrgPage = cache(async (slug: string) => getJamiiPageBySlug(slug));

export const loadCampaign = cache(async (pageSlug: string, campaignSlug: string) =>
  getCampaignBySlug(pageSlug, campaignSlug));

export async function loadCampaignExtras(campaignId: string) {
  const [stats, donations] = await Promise.all([
    getCampaignStats(campaignId),
    listRecentDonations(campaignId),
  ]);
  return { stats, donations };
}

export function isVerified(org: { party: { attestations: { id: string }[] } }): boolean {
  return org.party.attestations.length > 0;
}

export function orgInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'CB';
}
