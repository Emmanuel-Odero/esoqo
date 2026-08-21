import type { FastifyBaseLogger } from 'fastify';
import { findStalledGroups } from '@esoko/db';
import { contributionGapSms } from '@esoko/domain';
import { sendSms } from '@esoko/auth/sms';

/**
 * The contribution-gap digest — the SMS counterpart to a dashboard, for
 * group signers who won't open one. Sent once, the day a group's
 * quiet streak first crosses QUIET_DAYS, not on every run while it
 * stays quiet — findStalledGroups can't tell "just crossed" from
 * "been quiet a month" on its own, so this job narrows to an exact
 * day-count match instead of adding a "already notified" table for a
 * first cut. Trade-off: if the job is down on the exact day a group
 * crosses the threshold, that group won't be flagged until it recovers
 * and stalls again — acceptable for a first version, worth a proper
 * sent-log if this proves useful.
 */
const QUIET_DAYS = 14;

export async function runContributionGapDigest(log: Pick<FastifyBaseLogger, 'error' | 'info'>): Promise<number> {
  const stalled = await findStalledGroups(QUIET_DAYS);
  const justCrossed = stalled.filter((g) => g.daysSinceLastContribution === QUIET_DAYS);

  let sent = 0;
  for (const group of justCrossed) {
    const message = contributionGapSms(group);
    try {
      await Promise.all(group.signerMsisdns.map((to) => sendSms(to, message, 'group-contribution-gap')));
      sent += group.signerMsisdns.length;
    } catch (e) {
      log.error({ err: e, orgId: group.orgId }, 'failed to send contribution-gap digest');
    }
  }

  if (justCrossed.length > 0) {
    log.info({ groups: justCrossed.length, messagesSent: sent }, 'contribution-gap digest sent');
  }
  return sent;
}
