import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

/** SMS_COST_PER_MESSAGE_KES — a configurable estimate, not an invoice
 *  reconciliation. See SmsSpend's schema comment for why this is
 *  deliberately approximate rather than blocked on a billing-API
 *  integration that doesn't exist yet. */
function costPerMessageKes(): number {
  const raw = process.env.SMS_COST_PER_MESSAGE_KES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0.8;
}

/**
 * Logged by sendSms itself (packages/auth/src/sms.ts) on every attempt,
 * console mode included — a console-mode send costs nothing for real,
 * but tagging it too keeps local dev numbers honest about *frequency*
 * even before a provider is wired up.
 */
export async function recordSmsSpend(purpose: string, provider: string): Promise<void> {
  await prisma.smsSpend.create({
    data: { purpose, provider, estimatedCostKes: costPerMessageKes() },
  }).catch(() => {
    // Best-effort — an SMS that actually sent must never fail because
    // its cost log couldn't write.
  });
}

export interface SmsSpendSummary {
  totalKes: number;
  totalMessages: number;
  byPurpose: { purpose: string; count: number; kes: number }[];
}

export async function getSmsSpendSummary(ctx: Ctx, days = 30): Promise<SmsSpendSummary> {
  requireCapability(ctx, 'report.read');
  const since = new Date(Date.now() - days * 864e5);

  const rows = await prisma.smsSpend.groupBy({
    by: ['purpose'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { estimatedCostKes: true },
    orderBy: { _count: { purpose: 'desc' } },
  });

  const byPurpose = rows.map((r) => ({
    purpose: r.purpose, count: r._count._all, kes: Number(r._sum.estimatedCostKes ?? 0),
  }));

  return {
    totalKes: byPurpose.reduce((s, r) => s + r.kes, 0),
    totalMessages: byPurpose.reduce((s, r) => s + r.count, 0),
    byPurpose,
  };
}
