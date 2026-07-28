import { createHash } from 'node:crypto';
import { prisma } from './client';
import type { Ctx } from './capabilities';

/**
 * Append-only, hash-chained audit log.
 *
 * Each row's hash covers the previous row's hash plus a canonical
 * serialisation of this row. Altering or deleting any row breaks every
 * hash after it, and `pnpm --filter @esoko/db audit:verify` will name
 * the first broken link.
 *
 * This exists because a regulator will eventually ask, and because
 * "trust us, we log things" is not an answer.
 */

const CHAIN_SEED = process.env.AUDIT_CHAIN_SEED ?? 'esoko-genesis';

function canonical(o: Record<string, unknown>): string {
  // Deterministic: keys sorted, no whitespace, undefined dropped.
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return JSON.stringify(
    keys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = o[k];
      return acc;
    }, {}),
  );
}

function link(prevHash: string, row: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash).update(canonical(row)).digest('hex');
}

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Records one event. Called inside the same transaction as the change
 * it describes wherever possible — an audit row that can be written
 * without its change (or vice versa) is worse than none.
 */
export async function recordAudit(
  ctx: Pick<Ctx, 'actorType' | 'actorId' | 'ip'>,
  input: AuditInput,
  tx: { auditEvent: typeof prisma.auditEvent } = prisma,
): Promise<{ hash: string }> {
  const last = await tx.auditEvent.findFirst({
    orderBy: { id: 'desc' },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? createHash('sha256').update(CHAIN_SEED).digest('hex');

  const occurredAt = new Date();
  const row = {
    occurredAt: occurredAt.toISOString(),
    actorType: ctx.actorType,
    actorId: ctx.actorId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    payload: input.payload ?? {},
    ip: ctx.ip ?? null,
  };
  const hash = link(prevHash, row);

  await tx.auditEvent.create({
    data: {
      occurredAt,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload as object,
      ip: row.ip,
      prevHash,
      hash,
    },
  });

  return { hash };
}

export interface ChainResult {
  ok: boolean;
  checked: number;
  brokenAtId?: string;
  brokenAtTime?: Date;
}

/** Walks the whole chain. Run it in CI and before any audit response. */
export async function verifyChain(batchSize = 1000): Promise<ChainResult> {
  let cursor: bigint | undefined;
  let expectedPrev = createHash('sha256').update(CHAIN_SEED).digest('hex');
  let checked = 0;

  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      if (r.prevHash !== expectedPrev) {
        return { ok: false, checked, brokenAtId: String(r.id), brokenAtTime: r.occurredAt };
      }
      const recomputed = link(r.prevHash, {
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        payload: r.payload,
        ip: r.ip,
      });
      if (recomputed !== r.hash) {
        return { ok: false, checked, brokenAtId: String(r.id), brokenAtTime: r.occurredAt };
      }
      expectedPrev = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
  }

  return { ok: true, checked };
}
