import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

/**
 * "Of everyone who has ever given, what fraction gives more than once?"
 * — the growth question nobody was tracking. A donation total that's
 * 90% one-time gifts is a very different business than one that's 60%
 * repeat givers; until now there was no way to tell those apart.
 *
 * Grouped by donorMsisdn, not donorPartyId — most donors never sign in
 * (donorPartyId is only set when ctx.partyId was attached at the time),
 * so the phone number is the only identity that reliably survives
 * across separate gifts.
 */
export interface RepeatRate {
  totalGivers: number;
  repeatGivers: number;
  repeatRatePct: number;
}

function toRepeatRate(counts: number[]): RepeatRate {
  const totalGivers = counts.length;
  const repeatGivers = counts.filter((n) => n > 1).length;
  return {
    totalGivers, repeatGivers,
    repeatRatePct: totalGivers ? Math.round((repeatGivers / totalGivers) * 1000) / 10 : 0,
  };
}

export async function getDonorRepeatRate(ctx: Ctx): Promise<RepeatRate> {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.donation.groupBy({
    by: ['donorMsisdn'], where: { status: 'CONFIRMED' }, _count: { _all: true },
  });
  return toRepeatRate(rows.map((r) => r._count._all));
}

/** Same shape, for chama contributions — is a group's membership
 *  actually showing up every cycle, or is participation one-and-done? */
export async function getContributorRepeatRate(ctx: Ctx): Promise<RepeatRate> {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.groupContribution.groupBy({
    by: ['contributorId'], where: { status: 'CONFIRMED' }, _count: { _all: true },
  });
  return toRepeatRate(rows.map((r) => r._count._all));
}
