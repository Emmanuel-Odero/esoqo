import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

export interface AuditFilter {
  action?: string;
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
    ...(f.action ? { action: { startsWith: f.action } } : {}),
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
