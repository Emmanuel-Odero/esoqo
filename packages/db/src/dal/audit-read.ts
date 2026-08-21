import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

export interface AuditFilter {
  /** Matches anywhere in the action string, not just a prefix — "confirmed"
   *  finds donation.confirmed, treasury.contribution.confirmed, etc. */
  action?: string;
  actorType?: 'SUBJECT' | 'STAFF' | 'AGENT' | 'SYSTEM' | 'ISSUER';
  actorId?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

export async function listAuditEvents(ctx: Ctx, f: AuditFilter = {}) {
  requireCapability(ctx, 'audit.read');

  const where = {
    ...(f.action ? { action: { contains: f.action, mode: 'insensitive' as const } } : {}),
    ...(f.actorType ? { actorType: f.actorType } : {}),
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.targetId ? { targetId: f.targetId } : {}),
    ...(f.from || f.to
      ? { occurredAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { id: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  // BigInt does not survive JSON. Serialise at the boundary.
  return { rows: rows.map((r) => ({ ...r, id: String(r.id) })), total };
}

export async function getAuditActionCounts(ctx: Ctx, days = 7) {
  requireCapability(ctx, 'audit.read');
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.auditEvent.groupBy({
    by: ['action'],
    where: { occurredAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { action: 'desc' } },
    take: 15,
  });
  return rows.map((r) => ({ action: r.action, count: r._count._all }));
}

/**
 * Every `recordAudit` call anywhere in the platform already writes an
 * `action` string like `treasury.contribution.declared` or
 * `pos_sale.recorded` — this has been true since the audit chain was
 * built, and getAuditActionCounts above has read it for years, just
 * never as a product-usage signal. This turns that same log into "which
 * features do people actually use" — chama contributions vs donations
 * vs POS vs registrations — with zero new instrumentation.
 *
 * Known high-signal actions are grouped into named features; anything
 * unmapped falls back to a title-cased guess from its own prefix, so a
 * newly added action string never disappears from the leaderboard, it
 * just starts in its own small bucket until someone maps it properly.
 */
const FEATURE_MAP: Record<string, string> = {
  treasury: 'Chama treasury', donation: 'Our Jamii donations', pos_sale: 'POS sales',
  store_order: 'Store commerce', commerce: 'Store commerce', registration: 'Registrations',
  payment: 'Registration payments', booking: 'Event ticketing', support_ticket: 'Support tickets',
  membership: 'Group membership', jamii_page: 'Our Jamii sites', jamii_post: 'Our Jamii sites',
  jamii_domain: 'Our Jamii sites', jamii_campaign: 'Our Jamii sites', jamii_program: 'Our Jamii sites',
  shift: 'POS operations', cashier: 'POS operations', document: 'Document verification',
};

function featureFor(action: string): string {
  const prefix = action.split('.')[0] || action;
  const mapped = FEATURE_MAP[prefix];
  if (mapped) return mapped;
  return prefix.split('_').map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

export interface FeatureAdoption { feature: string; count: number }

export async function getFeatureAdoption(ctx: Ctx, days = 30): Promise<FeatureAdoption[]> {
  requireCapability(ctx, 'report.read');
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.auditEvent.groupBy({
    by: ['action'],
    where: { occurredAt: { gte: since } },
    _count: { _all: true },
  });

  const byFeature = new Map<string, number>();
  for (const r of rows) {
    const f = featureFor(r.action);
    byFeature.set(f, (byFeature.get(f) ?? 0) + r._count._all);
  }

  return [...byFeature.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
