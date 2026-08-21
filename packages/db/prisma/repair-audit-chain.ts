import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * One-time repair, not a schema migration — run once by hand after the
 * `sortDeep`/`canonical` fix in packages/db/src/audit.ts ships. Every
 * hash in the chain up to that fix was computed with a canonicaliser
 * that only sorted the row's TOP-LEVEL keys, not the `payload` object
 * nested inside it — and Postgres's `jsonb` column doesn't preserve the
 * original JS key insertion order on read, so a hash computed at
 * write-time and recomputed at verify-time could legitimately disagree
 * on nothing more than key order. That read as "the chain is broken"
 * for events that were never tampered with.
 *
 * This walks every row in id order and rewrites prevHash/hash using
 * the corrected (deep-sorted) algorithm, so the chain is internally
 * consistent again end to end. It does NOT touch occurredAt, action,
 * actorType, actorId, targetType, targetId, payload or ip — only the
 * two hash columns, which is exactly the same content the fixed
 * algorithm would have produced the first time had it been correct
 * from the start. Idempotent: rerunning after a successful repair
 * recomputes the same hashes and writes the same values.
 *
 * Run with: pnpm --filter @esoko/db repair:audit-chain
 */

const CHAIN_SEED = process.env.AUDIT_CHAIN_SEED ?? 'esoko-genesis';

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .reduce<Record<string, unknown>>((acc, k) => { acc[k] = sortDeep(o[k]); return acc; }, {});
  }
  return v;
}
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(sortDeep(o));
}
function link(prevHash: string, row: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash).update(canonical(row)).digest('hex');
}

async function main() {
  let expectedPrev = createHash('sha256').update(CHAIN_SEED).digest('hex');
  let cursor: bigint | undefined;
  let rewritten = 0;
  let unchanged = 0;

  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      const hash = link(expectedPrev, {
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        payload: r.payload,
        ip: r.ip,
      });

      if (r.prevHash !== expectedPrev || r.hash !== hash) {
        await prisma.auditEvent.update({ where: { id: r.id }, data: { prevHash: expectedPrev, hash } });
        rewritten++;
      } else {
        unchanged++;
      }

      expectedPrev = hash;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  console.log(`repaired ${rewritten} row(s), ${unchanged} already correct — chain now ends at ${expectedPrev}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
