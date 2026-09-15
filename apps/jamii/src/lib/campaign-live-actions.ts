'use server';

import { getCampaignStats, listRecentDonations } from '@esoqo/db';

export interface CampaignLiveStats {
  raisedKes: number;
  supporters: number;
  donations: {
    id: string;
    donorName: string;
    anonymous: boolean;
    amountKes: number;
    confirmedAt: string | null;
  }[];
}

/**
 * Polled by CampaignLiveStats (client) so the ledger bar and supporter
 * wall update within seconds of a donation confirming — no auth, same
 * as the page itself: this is exactly what's already shown to every
 * visitor on first load, just re-fetched. Confirmation can land from
 * either apps/jamii's own donate() (console-mode auto-confirm) or
 * services/core's Daraja webhook (confirmDonationPayment) — both write
 * to the same Postgres, so polling sees either path with no extra
 * plumbing between the two processes.
 */
export async function actionGetCampaignLiveStats(campaignId: string): Promise<CampaignLiveStats> {
  const [stats, donations] = await Promise.all([
    getCampaignStats(campaignId),
    listRecentDonations(campaignId),
  ]);
  return {
    raisedKes: stats.raisedKes,
    supporters: stats.supporters,
    donations: donations.map((d) => ({
      id: d.id,
      donorName: d.donorName,
      anonymous: d.anonymous,
      amountKes: Number(d.amountKes),
      confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
    })),
  };
}
