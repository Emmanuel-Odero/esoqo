import { prisma } from '../client';
import { requireCapability, AuthorisationError, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { Prisma } from '@prisma/client';

/**
 * Godown (warehouse) operations: storage/handling billing and stock
 * location — the two things a WAREHOUSE Organisation actually does,
 * per the approved plan ("they do all the above": paid storage for a
 * merchant's own goods, AND acting as another seller's fulfilment
 * point). Billing is always manually triggered — see postWarehouseFee's
 * doc-comment — there is no cron anywhere in this codebase.
 */

export class WarehouseError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'BAD_INPUT') {
    super(msg);
    this.name = 'WarehouseError';
  }
}

/** Staff holding the plain warehouse.write capability may manage any
 *  godown. A subject only holds warehouse.write:own, confirmed as
 *  themselves — for them this additionally requires an active
 *  membership at the warehouse Organisation, same reasoning as
 *  requireMallOfficer (biz-path registration only ever creates one
 *  OTHER/"Owner" membership, not a chama-shaped officer roster). */
async function requireWarehouseOfficer(ctx: Ctx, warehouseOrgId: string) {
  requireCapability(ctx, 'warehouse.write', { partyId: ctx.partyId });
  if (ctx.actorType === 'STAFF') return;
  if (!ctx.partyId) throw new AuthorisationError('warehouse.write', ctx);
  const m = await prisma.membership.findFirst({
    where: { orgId: warehouseOrgId, personId: ctx.partyId, exitedAt: null, status: 'ACTIVE' },
  });
  if (!m) throw new AuthorisationError('warehouse.write', ctx);
}

async function assertIsWarehouse(warehouseOrgId: string) {
  const org = await prisma.organisation.findUnique({ where: { partyId: warehouseOrgId }, select: { kind: true } });
  if (!org) throw new WarehouseError('Warehouse not found', 'NOT_FOUND');
  if (org.kind !== 'WAREHOUSE') throw new WarehouseError('That organisation is not a warehouse', 'BAD_INPUT');
}

/** Adds (or reinstates a previously-ended) storage agreement — same
 *  idempotent-on-the-pair shape as addTenant, though a merchant could
 *  in principle hold more than one active agreement at different fee
 *  terms, so this is keyed by id, not a unique constraint on the pair. */
export async function createStorageAgreement(
  ctx: Ctx, warehouseOrgId: string, tenantEnterpriseId: string,
  feeKes: number, billingPeriod: 'MONTHLY' | 'PER_UNIT', unitLabel?: string,
) {
  await requireWarehouseOfficer(ctx, warehouseOrgId);
  await assertIsWarehouse(warehouseOrgId);
  if (feeKes <= 0) throw new WarehouseError('Enter a fee above zero', 'BAD_INPUT');

  const enterprise = await prisma.enterprise.findUnique({ where: { id: tenantEnterpriseId } });
  if (!enterprise) throw new WarehouseError('Enterprise not found', 'NOT_FOUND');

  const agreement = await prisma.storageAgreement.create({
    data: { warehouseOrgId, tenantEnterpriseId, feeKes, billingPeriod, unitLabel: unitLabel || null },
  });
  await recordAudit(ctx, {
    action: 'storage_agreement.created', targetType: 'storage_agreement', targetId: agreement.id,
    payload: { warehouseOrgId, tenantEnterpriseId, feeKes, billingPeriod },
  });
  return agreement;
}

export async function endStorageAgreement(ctx: Ctx, agreementId: string, reason?: string) {
  const existing = await prisma.storageAgreement.findUnique({ where: { id: agreementId } });
  if (!existing) throw new WarehouseError('Agreement not found', 'NOT_FOUND');
  await requireWarehouseOfficer(ctx, existing.warehouseOrgId);

  const a = await prisma.storageAgreement.update({ where: { id: agreementId }, data: { endedAt: new Date() } });
  await recordAudit(ctx, {
    action: 'storage_agreement.ended', targetType: 'storage_agreement', targetId: agreementId, payload: { reason },
  });
  return a;
}

export async function listStorageAgreements(ctx: Ctx, warehouseOrgId: string) {
  await requireWarehouseOfficer(ctx, warehouseOrgId);
  return prisma.storageAgreement.findMany({
    where: { warehouseOrgId },
    include: { tenantEnterprise: { select: { workRaw: true } } },
    orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
  });
}

/** Sets the snapshot quantity of one seller's stock (product or variant)
 *  currently held at a godown — upsert, not a movement ledger (none
 *  exists yet). Setting quantity to 0 leaves the row (an explicit "we
 *  hold none of this right now"), rather than deleting it. */
export async function upsertStockLocation(
  ctx: Ctx, warehouseOrgId: string, storeId: string,
  quantity: number, productId?: string | null, variantId?: string | null,
) {
  await requireWarehouseOfficer(ctx, warehouseOrgId);
  await assertIsWarehouse(warehouseOrgId);
  if (quantity < 0) throw new WarehouseError('Quantity cannot be negative', 'BAD_INPUT');

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new WarehouseError('Store not found', 'NOT_FOUND');

  // Prisma can't type-safely upsert on a compound unique key with
  // nullable members (NULL != NULL breaks the uniqueness guarantee at
  // the SQL level) — find-then-write instead, same shape as
  // findOrCreateCustomer's manual identity resolution.
  const existing = await prisma.stockLocation.findFirst({
    where: { warehouseOrgId, storeId, productId: productId ?? null, variantId: variantId ?? null },
  });
  const loc = existing
    ? await prisma.stockLocation.update({ where: { id: existing.id }, data: { quantity } })
    : await prisma.stockLocation.create({
        data: { warehouseOrgId, storeId, productId: productId || null, variantId: variantId || null, quantity },
      });
  await recordAudit(ctx, {
    action: 'stock_location.set', targetType: 'stock_location', targetId: loc.id,
    payload: { warehouseOrgId, storeId, productId, variantId, quantity },
  });
  return loc;
}

export async function listStockAtWarehouse(ctx: Ctx, warehouseOrgId: string) {
  await requireWarehouseOfficer(ctx, warehouseOrgId);
  return prisma.stockLocation.findMany({
    where: { warehouseOrgId },
    include: {
      store: { select: { id: true, name: true, slug: true } },
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, label: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

async function findOrCreateAccount(
  tx: Prisma.TransactionClient,
  partyId: string | null,
  kind: 'WAREHOUSE_REVENUE' | 'FEE_INCOME' | 'SETTLEMENT',
) {
  const existing = await tx.account.findFirst({ where: { partyId, kind, currency: 'KES' } });
  if (existing) return existing;
  return tx.account.create({ data: { partyId, kind, currency: 'KES' } });
}

export interface PostWarehouseFeeInput {
  warehouseOrgId: string;
  amountKes: number;
  reference: string;
  description: string;
  /** e.g. `WAREHOUSE-{agreementId}-{YYYY-MM}` — safe to retry/re-trigger. */
  idempotencyKey: string;
}

/**
 * Posts a godown's storage/handling fee — money in, split between the
 * warehouse's own WAREHOUSE_REVENUE account and the platform's cut,
 * exact mirror of postStoreSale's three-account balanced-posting shape.
 * Idempotent on idempotencyKey, so a "Bill this period" admin action
 * can be safely clicked twice without double-charging — the same
 * guarantee that lets a retried M-Pesa callback never double-credit a
 * store sale. Always manually triggered: there is no cron anywhere in
 * this codebase, and this follows the one recurring-payment-shaped
 * precedent that exists (chama treasury contributions), not a new one.
 */
export async function postWarehouseFee(input: PostWarehouseFeeInput) {
  const existing = await prisma.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  const feeRule = await prisma.pricingRule.findUnique({ where: { key: 'PLATFORM_FEE_PCT' } });
  const feePct = feeRule?.amountPct ? Number(feeRule.amountPct) : 0;
  const fee = Math.round(input.amountKes * (feePct / 100) * 100) / 100;
  const netToWarehouse = input.amountKes - fee;

  return prisma.$transaction(async (tx) => {
    const settlement = await findOrCreateAccount(tx, null, 'SETTLEMENT');
    const revenue = await findOrCreateAccount(tx, input.warehouseOrgId, 'WAREHOUSE_REVENUE');

    const postings: Prisma.PostingCreateWithoutEntryInput[] = [
      { account: { connect: { id: settlement.id } }, amount: input.amountKes },
      { account: { connect: { id: revenue.id } }, amount: -netToWarehouse },
    ];
    if (fee > 0) {
      const feeIncome = await findOrCreateAccount(tx, null, 'FEE_INCOME');
      postings.push({ account: { connect: { id: feeIncome.id } }, amount: -fee });
    }

    const entry = await tx.journalEntry.create({
      data: {
        reference: input.reference,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        postings: { create: postings },
      },
    });

    await recordAudit(
      systemCtx('warehouse-billing'),
      {
        action: 'warehouse.fee_posted', targetType: 'journal_entry', targetId: entry.id,
        payload: { warehouseOrgId: input.warehouseOrgId, amountKes: input.amountKes, fee, reference: input.reference },
      },
      tx as never,
    );

    return entry;
  });
}

/** The "Bill this period" admin action — posts one StorageAgreement's
 *  fee for the current calendar month. Idempotency key is derived from
 *  the agreement + month, so clicking it twice in the same month is a
 *  safe no-op rather than a double charge. */
export async function billStoragePeriod(ctx: Ctx, agreementId: string) {
  const agreement = await prisma.storageAgreement.findUnique({
    where: { id: agreementId },
    include: { tenantEnterprise: { select: { workRaw: true } } },
  });
  if (!agreement) throw new WarehouseError('Agreement not found', 'NOT_FOUND');
  await requireWarehouseOfficer(ctx, agreement.warehouseOrgId);
  if (agreement.endedAt) throw new WarehouseError('This agreement has ended', 'BAD_INPUT');

  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  return postWarehouseFee({
    warehouseOrgId: agreement.warehouseOrgId,
    amountKes: Number(agreement.feeKes),
    reference: `WAREHOUSE-${agreement.id}-${period}`,
    description: `Storage fee — ${agreement.tenantEnterprise.workRaw} (${period})`,
    idempotencyKey: `WAREHOUSE-${agreement.id}-${period}`,
  });
}
