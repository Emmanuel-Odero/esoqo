import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { postStoreSale } from './_commerce-ledger';
import type { Prisma } from '@prisma/client';

/**
 * Customers, the credit book, and loyalty points.
 *
 * Balances are DERIVED, never stored — same rule as the accounting
 * ledger this schema is built around (see the schema header). A
 * customer's balance is the sum of their CustomerLedgerEntry rows, their
 * points balance the sum of their LoyaltyEntry rows. Nothing here ever
 * writes a running total onto StoreCustomer itself.
 */

export class CustomerError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'BAD_INPUT') {
    super(msg);
    this.name = 'CustomerError';
  }
}

/**
 * Finds or creates a store's customer record by phone — the "auto
 * capture" a POS sale or an estore checkout does the moment a phone
 * number is on the ticket, so a shopper doesn't need to be deliberately
 * added first. Deliberately not capability-gated: a public checkout
 * (createStoreOrder) calls this with the same anonymous-buyer context
 * that lets it place an order at all, the same reasoning as that
 * function's own "no capability required" comment.
 */
/**
 * Resolves or creates the customer record a sale/order attaches to.
 *
 * When `partyId` is given (an org buying on account, see
 * createStoreOrder's `buyingOrgId`), identity resolves by
 * `(storeId, partyId)` first — a stable identity across whichever member
 * of the org happens to place the order — falling back to the existing
 * `(storeId, msisdn)` lookup only if no org-linked row exists yet.
 * Every existing anonymous-consumer call site (no partyId) is
 * unaffected — same behaviour as before.
 */
export async function findOrCreateCustomer(
  storeId: string, msisdn: string, name?: string | null, partyId?: string | null,
) {
  const trimmed = msisdn.trim();
  if (!trimmed) throw new CustomerError('A phone number is required', 'BAD_INPUT');

  if (partyId) {
    const existingByParty = await prisma.storeCustomer.findFirst({ where: { storeId, partyId } });
    if (existingByParty) {
      if (name && !existingByParty.name) {
        return prisma.storeCustomer.update({ where: { id: existingByParty.id }, data: { name } });
      }
      return existingByParty;
    }
  }

  const existing = await prisma.storeCustomer.findUnique({ where: { storeId_msisdn: { storeId, msisdn: trimmed } } });
  if (existing) {
    // A name arriving later (e.g. POS didn't have one, checkout did) is
    // worth keeping — but never overwrite a name already on file. An
    // org buyer placing their first order through an already-known phone
    // number gets linked here too, rather than spawning a second row.
    if ((name && !existing.name) || (partyId && !existing.partyId)) {
      return prisma.storeCustomer.update({
        where: { id: existing.id },
        data: { name: name && !existing.name ? name : undefined, partyId: partyId ?? undefined },
      });
    }
    return existing;
  }
  return prisma.storeCustomer.create({
    data: { storeId, msisdn: trimmed, name: name || null, partyId: partyId || null },
  });
}

function balanceOf(entries: { amountKes: Prisma.Decimal }[]) {
  return Math.round(entries.reduce((sum, e) => sum + Number(e.amountKes), 0) * 100) / 100;
}
function pointsOf(entries: { points: number }[]) {
  return entries.reduce((sum, e) => sum + e.points, 0);
}

export async function listCustomers(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'customer.read');
  const customers = await prisma.storeCustomer.findMany({
    where: { storeId },
    include: {
      ledger: { select: { amountKes: true } }, loyalty: { select: { points: true } },
      party: { include: { organisation: { select: { officialName: true, knownAs: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return customers.map((c) => ({
    id: c.id, storeId: c.storeId, msisdn: c.msisdn, name: c.name, notes: c.notes,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
    balanceKes: balanceOf(c.ledger), points: pointsOf(c.loyalty),
    // Set only for an org buying on account — see findOrCreateCustomer.
    orgName: c.party?.organisation?.knownAs || c.party?.organisation?.officialName || null,
    creditLimitKes: c.creditLimitKes ? Number(c.creditLimitKes) : null,
    creditTermsDays: c.creditTermsDays,
  }));
}

/** Every customer currently owing the shop money, biggest balance
 *  first — the credit book's own view, rather than paging through each
 *  customer's ledger to find out who's on it. `owingSinceAt` is the
 *  oldest SALE entry still on file for them; a rough "how long has this
 *  been outstanding" signal, not a precise FIFO settlement date. */
export async function listDebts(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'customer.read');
  const customers = await prisma.storeCustomer.findMany({
    where: { storeId },
    include: {
      ledger: { orderBy: { createdAt: 'asc' }, select: { kind: true, amountKes: true, createdAt: true } },
      party: { include: { organisation: { select: { officialName: true, knownAs: true } } } },
    },
  });

  return customers
    .map((c) => ({
      id: c.id, name: c.name, msisdn: c.msisdn,
      orgName: c.party?.organisation?.knownAs || c.party?.organisation?.officialName || null,
      balanceKes: balanceOf(c.ledger),
      owingSinceAt: c.ledger.find((e) => e.kind === 'SALE')?.createdAt ?? null,
    }))
    .filter((c) => c.balanceKes > 0)
    .sort((a, b) => b.balanceKes - a.balanceKes);
}

export async function getCustomerDetail(ctx: Ctx, customerId: string) {
  const customer = await prisma.storeCustomer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerError('Customer not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, customer.storeId, 'customer.read');

  const [ledger, loyalty] = await Promise.all([
    prisma.customerLedgerEntry.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
    prisma.loyaltyEntry.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
  ]);
  return { customer, ledger, loyalty, balanceKes: balanceOf(ledger), points: pointsOf(loyalty) };
}

export async function updateCustomer(ctx: Ctx, customerId: string, patch: { name?: string | null; notes?: string | null }) {
  const customer = await prisma.storeCustomer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerError('Customer not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, customer.storeId, 'customer.write');

  const updated = await prisma.storeCustomer.update({ where: { id: customerId }, data: patch });
  await recordAudit(ctx, { action: 'customer.updated', targetType: 'store_customer', targetId: customerId, payload: patch });
  return updated;
}

/**
 * A customer paying down what they owe — cash (or till) actually
 * arriving now, unlike the ON_ACCOUNT sale that created the debt. Posts
 * both sides: the credit-book entry (their balance drops) and the
 * commerce ledger (the merchant's revenue account actually gets this
 * money now, platform fee included, the same as any other settled
 * sale) — see postStoreSale.
 */
export async function recordCustomerPayment(ctx: Ctx, customerId: string, amountKes: number, note?: string) {
  if (amountKes <= 0) throw new CustomerError('Enter an amount above zero', 'BAD_INPUT');
  const customer = await prisma.storeCustomer.findUnique({ where: { id: customerId }, include: { store: { include: { enterprise: true } } } });
  if (!customer) throw new CustomerError('Customer not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, customer.storeId, 'customer.write');

  const entry = await prisma.customerLedgerEntry.create({
    data: { customerId, kind: 'PAYMENT', amountKes: -amountKes, note: note?.trim() || null },
  });

  await postStoreSale({
    storeOwnerPartyId: customer.store.enterprise.partyId,
    totalKes: amountKes,
    reference: `CREDIT-PAYMENT-${entry.id}`,
    description: `Credit payment — ${customer.name ?? customer.msisdn}`,
    idempotencyKey: entry.id,
  });

  await recordAudit(ctx, {
    action: 'customer.payment_recorded', targetType: 'store_customer', targetId: customerId,
    payload: { amountKes },
  });
  return entry;
}

/** A manual correction to what a customer owes — writing off a bad debt,
 *  fixing a data-entry mistake. Always visible on the ledger, never a
 *  silent balance edit. */
export async function adjustCustomerBalance(ctx: Ctx, customerId: string, amountKes: number, note: string) {
  if (!note.trim()) throw new CustomerError('Say why you are adjusting this balance', 'BAD_INPUT');
  const customer = await prisma.storeCustomer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerError('Customer not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, customer.storeId, 'customer.write');

  const entry = await prisma.customerLedgerEntry.create({
    data: { customerId, kind: 'ADJUSTMENT', amountKes, note: note.trim() },
  });
  await recordAudit(ctx, { action: 'customer.balance_adjusted', targetType: 'store_customer', targetId: customerId, payload: { amountKes, note } });
  return entry;
}

/** A charge going onto the credit book at the moment of an ON_ACCOUNT
 *  sale — called from recordPosSale, not exposed as its own Server
 *  Action (a sale is the only legitimate way a SALE-kind entry appears). */
export async function chargeCustomerForSale(customerId: string, saleId: string, amountKes: number) {
  return prisma.customerLedgerEntry.create({
    data: { customerId, kind: 'SALE', amountKes, saleId, note: 'PoS sale on account' },
  });
}

export async function redeemLoyalty(ctx: Ctx, customerId: string, points: number, note?: string) {
  if (points <= 0) throw new CustomerError('Enter points above zero', 'BAD_INPUT');
  const customer = await prisma.storeCustomer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerError('Customer not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, customer.storeId, 'customer.write');

  const { points: balance } = await getCustomerDetail(ctx, customerId);
  if (points > balance) throw new CustomerError(`This customer only has ${balance} points`, 'BAD_INPUT');

  const entry = await prisma.loyaltyEntry.create({
    data: { customerId, points: -points, kind: 'REDEEM', note: note?.trim() || null },
  });
  await recordAudit(ctx, { action: 'customer.loyalty_redeemed', targetType: 'store_customer', targetId: customerId, payload: { points } });
  return entry;
}

/** Points earned on a completed sale — store.loyaltyPerKes points per
 *  whole KES. A no-op when the store hasn't turned loyalty on; called
 *  from recordPosSale and confirmStoreOrderPayment right after the sale
 *  itself is committed, never exposed as a standalone Server Action. */
export async function earnLoyaltyForSale(
  storeId: string,
  customerId: string,
  totalKes: number,
  ref: { saleId?: string; orderId?: string },
) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { loyaltyEnabled: true, loyaltyPerKes: true } });
  if (!store?.loyaltyEnabled || store.loyaltyPerKes <= 0) return null;

  const points = Math.floor(totalKes * store.loyaltyPerKes);
  if (points <= 0) return null;

  return prisma.loyaltyEntry.create({
    data: { customerId, points, kind: 'EARN', saleId: ref.saleId, orderId: ref.orderId },
  });
}

