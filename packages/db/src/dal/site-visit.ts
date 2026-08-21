import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

/**
 * Cookieless, day-bucketed page-visit logging — see SiteVisit's schema
 * comment for the privacy trade this makes. The only writer is
 * apps/jamii/src/middleware.ts, which runs on every request and already
 * knows domainMode/slug for free from resolving custom domains — this
 * function does no lookup of its own, just an upsert.
 *
 * Deliberately no ctx/capability check — this is called from middleware,
 * before any session exists, for an anonymous visitor. It only ever
 * increments a same-day counter; there's nothing here to protect.
 */
export async function recordSiteVisit(input: {
  slug: string;
  path: string;
  domainMode: 'PRIMARY' | 'CUSTOM';
  referrerHost: string | null;
}): Promise<void> {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const referrerHost = input.referrerHost ?? '';

  await prisma.siteVisit.upsert({
    where: {
      slug_path_domainMode_day_referrerHost: {
        slug: input.slug, path: input.path, domainMode: input.domainMode, day, referrerHost,
      },
    },
    create: { slug: input.slug, path: input.path, domainMode: input.domainMode, day, referrerHost, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export interface SiteVisitRanking {
  slug: string;
  visits: number;
  customDomainVisits: number;
  primaryVisits: number;
}

/** Ranks every org by total visits — the "which Our Jamii sites are
 *  actually thriving" leaderboard, and the custom-vs-primary split the
 *  dashboard proposal specifically called out as missing entirely. */
export async function getSiteVisitLeaderboard(ctx: Ctx, days = 30, take = 10): Promise<SiteVisitRanking[]> {
  requireCapability(ctx, 'report.read');
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0);

  const rows = await prisma.siteVisit.groupBy({
    by: ['slug', 'domainMode'],
    where: { day: { gte: since } },
    _sum: { count: true },
  });

  const bySlug = new Map<string, SiteVisitRanking>();
  for (const r of rows) {
    const n = r._sum.count ?? 0;
    const cur = bySlug.get(r.slug) ?? { slug: r.slug, visits: 0, customDomainVisits: 0, primaryVisits: 0 };
    cur.visits += n;
    if (r.domainMode === 'CUSTOM') cur.customDomainVisits += n; else cur.primaryVisits += n;
    bySlug.set(r.slug, cur);
  }

  return [...bySlug.values()].sort((a, b) => b.visits - a.visits).slice(0, take);
}

/** Platform-wide domain split — every visit, regardless of which org,
 *  bucketed by how the visitor arrived. Answers "are custom domains
 *  actually pulling their weight" at a glance. */
export async function getSiteVisitDomainSplit(ctx: Ctx, days = 30): Promise<{ primary: number; custom: number }> {
  requireCapability(ctx, 'report.read');
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0);

  const rows = await prisma.siteVisit.groupBy({
    by: ['domainMode'],
    where: { day: { gte: since } },
    _sum: { count: true },
  });

  const out = { primary: 0, custom: 0 };
  for (const r of rows) {
    if (r.domainMode === 'PRIMARY') out.primary += r._sum.count ?? 0;
    else out.custom += r._sum.count ?? 0;
  }
  return out;
}

/** Top pages for one org — powers a future "most visited pages" panel
 *  on the org's own Our Jamii dashboard. */
export async function getTopPagesForSite(ctx: Ctx, slug: string, days = 30, take = 8) {
  requireCapability(ctx, 'report.read');
  const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0);

  const rows = await prisma.siteVisit.groupBy({
    by: ['path'],
    where: { slug, day: { gte: since } },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
    take,
  });
  return rows.map((r) => ({ path: r.path, visits: r._sum.count ?? 0 }));
}
