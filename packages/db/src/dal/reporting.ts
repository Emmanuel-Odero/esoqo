import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

/**
 * Admin reporting.
 *
 * The metrics here are deliberately the ones from the journey-map work:
 * D30 activation, funnel completion, county and segment spread — NOT
 * "total registered", which is the vanity number that made the CECF
 * platform's reporting meaningless.
 */

export interface Overview {
  registrationsStarted: number;
  registrationsComplete: number;
  completionRate: number;
  parties: number;
  organisations: number;
  last7d: number;
  last24h: number;
  awaitingOtp: number;
  abandoned: number;
}

export async function getOverview(ctx: Ctx): Promise<Overview> {
  requireCapability(ctx, 'report.read');

  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d1 = new Date(now - 864e5);

  const [started, complete, parties, orgs, last7d, last24h, awaitingOtp, abandoned] =
    await Promise.all([
      prisma.registration.count(),
      prisma.registration.count({ where: { status: 'COMPLETE' } }),
      prisma.party.count({ where: { kind: 'PERSON', deletedAt: null } }),
      prisma.party.count({ where: { kind: 'ORGANISATION', deletedAt: null } }),
      prisma.registration.count({ where: { completedAt: { gte: d7 } } }),
      prisma.registration.count({ where: { completedAt: { gte: d1 } } }),
      prisma.registration.count({ where: { status: 'AWAITING_OTP' } }),
      prisma.registration.count({ where: { status: 'ABANDONED' } }),
    ]);

  return {
    registrationsStarted: started,
    registrationsComplete: complete,
    completionRate: started ? Math.round((complete / started) * 1000) / 10 : 0,
    parties,
    organisations: orgs,
    last7d,
    last24h,
    awaitingOtp,
    abandoned,
  };
}

/** Where the funnel leaks. The most useful table in the admin app. */
export async function getFunnel(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.registration.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const order = ['STARTED', 'AWAITING_OTP', 'VERIFIED', 'COMPLETE', 'ABANDONED'];
  return order.map((s) => ({
    status: s,
    count: rows.find((r) => r.status === s)?._count._all ?? 0,
  }));
}

/** The join-flow steps, in order, for the drop-off funnel below. Keep in
 *  sync with apps/app/src/app/join/JoinFlow.tsx's step numbering. */
export const JOIN_FLOW_STEPS = [
  { step: 1, label: 'Who is joining' },
  { step: 2, label: 'Group membership' },
  { step: 3, label: 'Name' },
  { step: 4, label: 'Contact details' },
  { step: 5, label: 'Work or trade' },
  { step: 6, label: 'Business standing' },
  { step: 7, label: 'Documents' },
  { step: 8, label: 'Payment' },
  { step: 9, label: 'Verify and finish' },
] as const;

/** Per-step drop-off — where people are actually getting stuck, not just
 *  the five coarse statuses `getFunnel` groups by. `reached` is
 *  cumulative (reached this step or later, or already completed);
 *  `stuckHere` is registrations whose furthest step IS this one and that
 *  never became COMPLETE. */
export async function getStepFunnel(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const steps = await Promise.all(
    JOIN_FLOW_STEPS.map(async ({ step, label }) => {
      const [reached, stuckHere] = await Promise.all([
        prisma.registration.count({
          where: { OR: [{ lastStep: { gte: step } }, { status: 'COMPLETE' }] },
        }),
        prisma.registration.count({
          where: { lastStep: step, status: { not: 'COMPLETE' } },
        }),
      ]);
      return { step, label, reached, stuckHere };
    }),
  );
  return steps;
}

/** Individuals by declared trade/segment — the "which sector has the most
 *  registered members" view, based on what each person typed for
 *  themselves (Registration.segment), not the group-level Enterprise
 *  record `getBySegment` uses. */
export async function getRegistrationSegments(ctx: Ctx, take = 20) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.registration.groupBy({
    by: ['segment'],
    where: { segment: { not: null }, status: 'COMPLETE' },
    _count: { _all: true },
    orderBy: { _count: { segment: 'desc' } },
    take,
  });
  return rows.map((r) => ({ segment: r.segment as string, count: r._count._all }));
}

/** Per-group detail for the dedicated group analytics page — member
 *  growth over time and how many linked registrations have their fee
 *  covered by the group vs paid independently vs not yet answered. */
export async function getGroupAnalytics(ctx: Ctx, orgPartyId: string) {
  requireCapability(ctx, 'report.read');
  const [feeCoverage, joinedByMonth] = await Promise.all([
    prisma.registration.groupBy({
      by: ['feeCoverage'],
      where: { groupPartyId: orgPartyId },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ month: Date; n: bigint }[]>`
      SELECT date_trunc('month', "joinedAt") AS month, COUNT(*)::bigint AS n
      FROM membership WHERE "orgId" = ${orgPartyId}::uuid AND "exitedAt" IS NULL
      GROUP BY 1 ORDER BY 1 ASC`,
  ]);
  return {
    feeCoverage: feeCoverage.map((f) => ({ coverage: f.feeCoverage ?? 'unknown', count: f._count._all })),
    joinedByMonth: joinedByMonth.map((r) => ({ month: r.month, count: Number(r.n) })),
  };
}

export async function getByCounty(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.registration.groupBy({
    by: ['county'],
    where: { status: 'COMPLETE', county: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { county: 'desc' } },
  });
  return rows.map((r) => ({ county: r.county ?? 'Unknown', count: r._count._all }));
}

export async function getBySegment(ctx: Ctx, take = 12) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.enterprise.groupBy({
    by: ['segment'],
    where: { segment: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { segment: 'desc' } },
    take,
  });
  return rows.map((r) => ({ segment: r.segment ?? 'Unclassified', count: r._count._all }));
}

export async function getJoiningAsSplit(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.registration.groupBy({
    by: ['joiningAs'],
    where: { status: 'COMPLETE' },
    _count: { _all: true },
  });
  return rows.map((r) => ({ joiningAs: r.joiningAs, count: r._count._all }));
}

/** Daily completions for a sparkline. */
export async function getDailyCompletions(ctx: Ctx, days = 30) {
  requireCapability(ctx, 'report.read');
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.$queryRaw<{ day: Date; n: bigint }[]>`
    SELECT date_trunc('day', "completedAt") AS day, COUNT(*)::bigint AS n
    FROM registration
    WHERE "completedAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC`;
  return rows.map((r) => ({ day: r.day, count: Number(r.n) }));
}

/** SMS opt-in rates. Tells us whether the consent design is working. */
export async function getOptInRates(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const total = await prisma.registration.count({ where: { status: 'COMPLETE' } });
  if (!total) return { total: 0, price: 0, receipt: 0, expiry: 0 };
  const [price, receipt, expiry] = await Promise.all([
    prisma.registration.count({ where: { status: 'COMPLETE', wantsPriceSms: true } }),
    prisma.registration.count({ where: { status: 'COMPLETE', wantsReceiptSms: true } }),
    prisma.registration.count({ where: { status: 'COMPLETE', wantsExpirySms: true } }),
  ]);
  const pc = (n: number) => Math.round((n / total) * 1000) / 10;
  return { total, price: pc(price), receipt: pc(receipt), expiry: pc(expiry) };
}

/** USSD-now vs later. Directly answers "did they take dialling access?" */
export async function getUssdChoiceSplit(ctx: Ctx) {
  requireCapability(ctx, 'report.read');
  const rows = await prisma.registration.groupBy({
    by: ['ussdSetupChoice'],
    where: { status: 'COMPLETE' },
    _count: { _all: true },
  });
  return rows.map((r) => ({ choice: r.ussdSetupChoice ?? 'not answered', count: r._count._all }));
}
