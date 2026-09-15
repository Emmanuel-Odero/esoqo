import { cache } from 'react';
import { getJamiiPageBySlug, getCampaignBySlug, getCampaignStats, listRecentDonations } from '@esoqo/db';

export { isVerified, orgInitials } from './org-links-shared';

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
