import { prisma } from '../client';

/**
 * "This chama went quiet" detection — the counterpart to a dashboard
 * for an audience that won't open one (see the dashboard proposal's
 * Capability 7). A group only qualifies if it has contributed
 * CONFIRMED before at all — a group that's simply new isn't "stalled",
 * it just hasn't started, and flagging it would just be noise.
 *
 * Not gated by ctx/requireCapability — this is read by
 * services/core's own scheduled digest job (see runContributionGapDigest
 * there), the same trust boundary as runJamiiDomainReconcile's queries.
 */
export interface StalledGroup {
  orgId: string;
  officialName: string;
  lastContributionAt: Date;
  daysSinceLastContribution: number;
  signerMsisdns: string[];
}

export async function findStalledGroups(quietDays = 14): Promise<StalledGroup[]> {
  const cutoff = new Date(Date.now() - quietDays * 864e5);

  const orgs = await prisma.organisation.findMany({
    where: { contributions: { some: { status: 'CONFIRMED' } } },
    select: {
      partyId: true,
      officialName: true,
      contributions: {
        where: { status: 'CONFIRMED' },
        orderBy: { confirmedAt: 'desc' },
        take: 1,
        select: { confirmedAt: true },
      },
      signers: {
        where: { removedAt: null },
        select: { person: { select: { person: { select: { msisdn: true } } } } },
      },
    },
  });

  const stalled: StalledGroup[] = [];
  for (const org of orgs) {
    const last = org.contributions[0]?.confirmedAt;
    if (!last || last >= cutoff) continue;

    const signerMsisdns = org.signers
      .map((s) => s.person.person?.msisdn)
      .filter((n): n is string => Boolean(n));
    if (signerMsisdns.length === 0) continue; // nobody to notify

    stalled.push({
      orgId: org.partyId,
      officialName: org.officialName,
      lastContributionAt: last,
      daysSinceLastContribution: Math.floor((Date.now() - last.getTime()) / 864e5),
      signerMsisdns,
    });
  }
  return stalled;
}
