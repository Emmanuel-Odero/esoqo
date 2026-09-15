import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';

/**
 * Cashiers.
 *
 * PIN hashing lives in @esoqo/auth (Argon2id, packages/auth/src/pin.ts)
 * — not here. @esoqo/auth depends on @esoqo/db, so this package can't
 * depend back on it without a cycle. Every function below takes an
 * already-hashed pinHash and never sees a raw PIN; the Server Action
 * layer (which already depends on both packages) hashes/verifies at the
 * boundary. See apps/store's cashiers actions for where that happens.
 */

export class CashierError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'BAD_INPUT') {
    super(msg);
    this.name = 'CashierError';
  }
}

export interface CreateCashierInput {
  name: string;
  pinHash: string;
  role?: 'CASHIER' | 'MANAGER';
}

export async function createCashier(ctx: Ctx, storeId: string, input: CreateCashierInput) {
  await assertOwnsStore(ctx, storeId, 'cashier.write');
  if (!input.name.trim()) throw new CashierError('Give the cashier a name', 'BAD_INPUT');

  const cashier = await prisma.cashier.create({
    data: { storeId, name: input.name.trim(), pinHash: input.pinHash, role: input.role ?? 'CASHIER' },
  });
  await recordAudit(ctx, { action: 'cashier.created', targetType: 'cashier', targetId: cashier.id, payload: { storeId, name: cashier.name, role: cashier.role } });
  return { id: cashier.id, storeId: cashier.storeId, name: cashier.name, role: cashier.role, active: cashier.active, createdAt: cashier.createdAt };
}

/** The picker list for the terminal and the management page — never
 *  includes pinHash. */
export async function listCashiers(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'cashier.write');
  const cashiers = await prisma.cashier.findMany({
    where: { storeId },
    select: { id: true, storeId: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
  return cashiers;
}

export async function setCashierActive(ctx: Ctx, cashierId: string, active: boolean) {
  const cashier = await prisma.cashier.findUnique({ where: { id: cashierId } });
  if (!cashier) throw new CashierError('Cashier not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, cashier.storeId, 'cashier.write');

  const updated = await prisma.cashier.update({ where: { id: cashierId }, data: { active } });
  await recordAudit(ctx, { action: active ? 'cashier.reactivated' : 'cashier.deactivated', targetType: 'cashier', targetId: cashierId });
  return { id: updated.id, name: updated.name, active: updated.active };
}

/** Fetches the pinHash for a check-in attempt. Internal-shaped — the
 *  Server Action that calls this is the only thing that should ever see
 *  a pinHash, and only for the instant it takes to verify it. Requires
 *  an already-authenticated owner ctx — this is the soft, in-dashboard
 *  "who's on the till" tag, not a sign-in. See getCashierPinHashForSignIn
 *  for the real thing. */
export async function getCashierPinHash(ctx: Ctx, storeId: string, cashierId: string) {
  await assertOwnsStore(ctx, storeId, 'pos.sell');
  const cashier = await prisma.cashier.findUnique({ where: { id: cashierId } });
  if (!cashier || cashier.storeId !== storeId || !cashier.active) {
    throw new CashierError('Cashier not found', 'NOT_FOUND');
  }
  return { id: cashier.id, name: cashier.name, role: cashier.role, pinHash: cashier.pinHash };
}

/* ── cashier sign-in — no owner session required ─────────────────
 * A cashier arrives at a bare terminal with no session at all, so this
 * can't gate on assertOwnsStore the way everything else does. It's
 * scoped instead by storeSlug — public knowledge, the same trust
 * boundary the storefront and checkout already use.
 *
 * Deliberately NOT a picker of staff names. An earlier version listed
 * every active cashier in a dropdown on this public page — convenient,
 * but it handed an attacker two things for free: the full staff roster
 * (a privacy leak on its own) and a target list to brute-force PINs
 * against, with no need to guess the name half of the credential at
 * all. Sign-in now takes the name as free text and is resolved here,
 * server-side, without ever exposing who works at the store. */

/** Resolves a sign-in attempt by name. Returns null (never throws) on
 *  no match — the caller verifies against DUMMY_PIN_HASH in that case
 *  so a wrong name and a wrong PIN are indistinguishable, in both the
 *  response and the time it takes to get one. */
export async function getCashierPinHashForSignIn(storeSlug: string, name: string) {
  const store = await prisma.store.findFirst({ where: { slug: storeSlug, status: 'ACTIVE' } });
  if (!store) return null;
  const cashier = await prisma.cashier.findFirst({
    where: { storeId: store.id, active: true, name: { equals: name.trim(), mode: 'insensitive' } },
  });
  if (!cashier) return null;
  return { id: cashier.id, storeId: store.id, name: cashier.name, role: cashier.role, pinHash: cashier.pinHash };
}

/** A signed-in cashier reading back their own name/role — authorised
 *  implicitly by ctx already being a valid AGENT session for this store
 *  (only issued after a real PIN check at sign-in), not by any
 *  capability. Returns nothing beyond what the cashier already knows
 *  about themselves. */
export async function getCashierSelf(ctx: Ctx) {
  if (ctx.actorType !== 'AGENT' || !ctx.storeId || !ctx.actorId) {
    throw new CashierError('Not a cashier session', 'NOT_FOUND');
  }
  const cashier = await prisma.cashier.findUnique({ where: { id: ctx.actorId } });
  if (!cashier || cashier.storeId !== ctx.storeId) throw new CashierError('Cashier not found', 'NOT_FOUND');
  return { id: cashier.id, name: cashier.name, role: cashier.role };
}
