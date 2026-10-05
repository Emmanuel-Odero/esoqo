import { prisma } from '../client';
import type { Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { assertOwnsStore } from './store';
import { isUniqueViolationOn } from './payment-id';
import { generateTransactionCode, TRANSACTION_CODE_KINDS } from '@esoqo/domain';
import type { Prisma } from '@prisma/client';

/**
 * Receipts.
 *
 * receiptNo is globally unique (the schema's own constraint) but reads
 * as sequential per store — "000147" means the 147th receipt THIS shop
 * has issued, not the platform's. So it's store-slug-prefixed: unique
 * across every store, still a small clean number to the merchant who
 * only ever sees their own. See nextReceiptNo.
 *
 * etimsSerial is deliberately never generated here. A real KRA eTIMS
 * serial comes from KRA's own fiscal device/OSCU-VSCU integration —
 * cryptographically signed, submitted to KRA, and only THEN valid. This
 * package has no such integration. Inventing a serial that merely looks
 * right would let a merchant hand a customer a receipt that claims
 * eTIMS compliance it doesn't have — worse than no serial at all. So
 * issueReceipt only ever stores an etimsSerial it was actually given by
 * a caller wired to a real KRA integration; until one exists, it stays
 * null and Store.etimsEnabled means "wants this," not "has this."
 */

export class ReceiptError extends Error {
  constructor(msg: string, public readonly code:
    | 'NOT_FOUND' | 'BAD_INPUT' | 'ALREADY_ITEMIZED' | 'NOT_ITEMIZABLE'
    | 'ITEM_UNAVAILABLE' | 'AMOUNT_MISMATCH') {
    super(msg);
    this.name = 'ReceiptError';
  }
}

/** `prefix` is the caller's — a store's slug for a normal receipt, a
 *  fixed platform-wide token for a receipt with no store to count
 *  against (see issueReceiptFor). `countWhere` is what "the Nth receipt"
 *  counts over, so the two stay in sync without this function needing to
 *  know why. */
async function nextReceiptNo(tx: Prisma.TransactionClient, prefix: string, countWhere: Prisma.ReceiptWhereInput): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await tx.receipt.count({ where: countWhere });
    const candidate = `${prefix}-${String(count + 1).padStart(6, '0')}`;
    const clash = await tx.receipt.findUnique({ where: { receiptNo: candidate } });
    if (!clash) return candidate;
  }
  // Astronomically unlikely to fall through five attempts — fall back to
  // something guaranteed unique rather than fail the receipt entirely.
  return `${prefix}-${Date.now()}`;
}

interface MintReceiptInput {
  storeId: string | null;
  storeSlug: string | null;
  countWhere: Prisma.ReceiptWhereInput;
  saleId?: string | null;
  orderId?: string | null;
  businessPaymentId?: string | null;
  totalKes: number;
  channel: 'PRINT' | 'SMS';
  sentTo?: string | null;
  etimsSerial?: string | null;
}

/**
 * The one place that actually writes a Receipt row and its two
 * customer-facing references — receiptNo (nextReceiptNo, above) and
 * receiptCode (generateTransactionCode). Both `issueReceipt` (the
 * manual print/SMS button) and `issueReceiptFor` (automatic issuance)
 * call this, so the two mints can no longer drift: before this, only
 * the automatic path minted a receiptCode at all, which meant a receipt
 * issued through the manual button had no /verify code — not a
 * deliberate distinction, just two call sites that grew apart.
 *
 * Retries only on a clash a fresh value would actually fix — the
 * receiptCode it just minted, or the receiptNo nextReceiptNo just
 * re-derived above (both re-computed per attempt, so a retry genuinely
 * can succeed). NOT on businessPaymentId, which is unique on Receipt but
 * is a value the *caller* supplied: a P2002 there means a receipt for
 * this payment already exists, and re-rolling our own code five times
 * cannot satisfy a constraint on someone else's column. issueReceiptFor
 * pre-checks for that case and returns the existing row; this is the
 * race the pre-check cannot cover, and failing it straight through to
 * the caller's own idempotency handling is correct where five doomed
 * transactions would not be.
 */
async function mintReceipt(input: MintReceiptInput) {
  const prefix = input.storeSlug ? input.storeSlug.slice(0, 12).toUpperCase() : STORELESS_PREFIX;
  let receipt: Prisma.ReceiptGetPayload<Record<string, never>> | undefined;
  for (let attempt = 0; attempt < 5 && !receipt; attempt++) {
    const receiptCode = generateTransactionCode(TRANSACTION_CODE_KINDS.RECEIPT);
    try {
      receipt = await prisma.$transaction(async (tx) => {
        const receiptNo = await nextReceiptNo(tx, prefix, input.countWhere);
        return tx.receipt.create({
          data: {
            storeId: input.storeId,
            receiptNo,
            receiptCode,
            saleId: input.saleId ?? null,
            orderId: input.orderId ?? null,
            businessPaymentId: input.businessPaymentId ?? null,
            totalKes: input.totalKes,
            etimsSerial: input.etimsSerial ?? null,
            channel: input.channel,
            sentTo: input.channel === 'SMS' ? input.sentTo ?? null : null,
          },
        });
      });
    } catch (e) {
      if (isUniqueViolationOn(e, ['receiptCode', 'receiptNo']) && attempt < 4) continue;
      throw e;
    }
  }
  if (!receipt) throw new Error('Could not issue a receipt — try again');
  return receipt;
}

export interface IssueReceiptInput {
  saleId?: string;
  orderId?: string;
  /** PRINT | SMS. WhatsApp isn't wired to a provider yet. */
  channel: 'PRINT' | 'SMS';
  /** The customer's phone, for an SMS copy — ignored for PRINT. */
  sentTo?: string;
  /** Only ever set by a real KRA eTIMS integration — see the module note above. */
  etimsSerial?: string;
}

export async function issueReceipt(ctx: Ctx, storeId: string, input: IssueReceiptInput) {
  const store = await assertOwnsStore(ctx, storeId, 'receipt.write');
  if (!input.saleId && !input.orderId) throw new ReceiptError('A receipt needs a sale or an order', 'BAD_INPUT');
  if (input.channel === 'SMS' && !input.sentTo) throw new ReceiptError('An SMS receipt needs a phone number', 'BAD_INPUT');

  let totalKes: number;
  if (input.saleId) {
    const sale = await prisma.posSale.findUnique({ where: { id: input.saleId } });
    if (!sale || sale.storeId !== storeId) throw new ReceiptError('Sale not found', 'NOT_FOUND');
    totalKes = Number(sale.totalKes);
  } else {
    const order = await prisma.storeOrder.findUnique({ where: { id: input.orderId } });
    if (!order || order.storeId !== storeId) throw new ReceiptError('Order not found', 'NOT_FOUND');
    totalKes = Number(order.totalKes);
  }

  const receipt = await mintReceipt({
    storeId, storeSlug: store.slug, countWhere: { storeId },
    saleId: input.saleId, orderId: input.orderId, totalKes,
    etimsSerial: store.etimsEnabled ? (input.etimsSerial ?? null) : null,
    channel: input.channel, sentTo: input.sentTo,
  });

  await recordAudit(ctx, {
    action: 'receipt.issued', targetType: 'receipt', targetId: receipt.id,
    payload: { storeId, saleId: input.saleId, orderId: input.orderId, channel: input.channel },
  });
  // storeName rides along because the SMS copy leads with it (see
  // domain/store-notify.ts) and the caller composing that message would
  // otherwise have to re-fetch the store this function already loaded.
  return { ...receipt, storeName: store.name };
}

export async function listReceiptsForSale(ctx: Ctx, storeId: string, saleId: string) {
  await assertOwnsStore(ctx, storeId, 'receipt.write');
  return prisma.receipt.findMany({ where: { storeId, saleId }, orderBy: { issuedAt: 'desc' } });
}

export async function getReceipt(ctx: Ctx, receiptId: string) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      store: true,
      sale: { include: { items: { include: { product: true, variant: true } }, cashier: true } },
      order: { include: { items: { include: { product: true } } } },
      items: { include: { product: true, variant: true } },
      businessPayment: true,
    },
  });
  // Storeless (see issueReceiptFor's zero/multiple-store-match case) means
  // there is no owning store for this dashboard-scoped getter to check
  // ownership against — same "id is the secret" contract, but this
  // function's whole point is a store-scoped view, so there is nothing
  // for it to show. The public verify page (verifyReceipt in
  // dal/reference.ts) is the one that can still show a storeless receipt.
  if (!receipt || !receipt.storeId || !receipt.store) throw new ReceiptError('Receipt not found', 'NOT_FOUND');
  await assertOwnsStore(ctx, receipt.storeId, 'receipt.write');
  return { ...receipt, storeId: receipt.storeId, store: receipt.store };
}

/* ── automatic issuance ──────────────────────────────────────────
   The counterpart to issueReceipt above, but never capability-checked:
   every caller here (recordPosSale, confirmStoreOrderPayment/Cod,
   confirmBusinessPayment) has already authorised — or, for a system
   callback, has no request ctx to authorise with — the settlement this
   receipt documents. Re-checking ownership here would be checking a
   decision this function's own caller already made. */

export interface IssueReceiptForInput {
  /** Null only for a BusinessPayment whose payee doesn't map to exactly
   *  one ACTIVE store — see the lookup in confirmBusinessPayment. */
  storeId: string | null;
  saleId?: string | null;
  orderId?: string | null;
  businessPaymentId?: string | null;
  totalKes: number;
  /** Present → an SMS copy is issued (channel: 'SMS', sentTo this
   *  number). Absent → PRINT, no text sent — the caller decides whether
   *  it actually has a number to send to. */
  buyerMsisdn?: string | null;
}

/** No store to count a sequential receiptNo against — a chama or an
 *  enterprise running several stores. Fixed, not derived from anything
 *  guessable, since it only ever prefixes a receiptNo, never a
 *  receiptCode (the actual secret). */
const STORELESS_PREFIX = 'ESOQO';

export async function issueReceiptFor(input: IssueReceiptForInput) {
  // businessPaymentId is the one source column that's actually @unique
  // on Receipt (a sale or an order may legitimately carry several
  // receipts — a print copy, a reprint, an SMS copy — so saleId/orderId
  // are NOT unique by design, and issueReceiptFor never treats them as
  // if they were). So a second call with the same businessPaymentId can
  // only mean a retry after a transient failure — a callback redelivery,
  // a caller that wraps this in its own try/again. Returning the
  // already-minted row instead of trying to insert a second one does
  // two things: it stops burning five receiptCode-retry attempts on a
  // constraint that a new receiptCode can never satisfy (the collision
  // is on businessPaymentId, not receiptCode), and it stops a retry from
  // texting the same buyer a second receipt for the same payment.
  if (input.businessPaymentId) {
    const existing = await prisma.receipt.findUnique({ where: { businessPaymentId: input.businessPaymentId } });
    if (existing) {
      const existingStore = existing.storeId ? await prisma.store.findUnique({ where: { id: existing.storeId } }) : null;
      return { ...existing, storeName: existingStore?.name ?? null };
    }
  }

  const store = input.storeId ? await prisma.store.findUnique({ where: { id: input.storeId } }) : null;
  const receipt = await mintReceipt({
    storeId: store?.id ?? null,
    storeSlug: store?.slug ?? null,
    countWhere: store ? { storeId: store.id } : { storeId: null },
    saleId: input.saleId, orderId: input.orderId, businessPaymentId: input.businessPaymentId,
    totalKes: input.totalKes,
    channel: input.buyerMsisdn ? 'SMS' : 'PRINT',
    sentTo: input.buyerMsisdn,
  });
  // storeName rides along for the same reason issueReceipt's does — the
  // SMS composer at the call site needs it and has no reason to
  // re-fetch the store this function already loaded.
  return { ...receipt, storeName: store?.name ?? null };
}

/* ── shopkeeper itemization of a BusinessPayment-backed receipt ──── */

/** Receipts on this store that arrived with money but no items yet —
 *  the dashboard's "Needs items" list. A PosSale/StoreOrder receipt
 *  never appears here; it already has items via sale.items/order.items,
 *  which is what the saleId/orderId: null filter below is selecting
 *  against. */
export async function listReceiptsNeedingItems(ctx: Ctx, storeId: string) {
  await assertOwnsStore(ctx, storeId, 'receipt.write');
  return prisma.receipt.findMany({
    where: { storeId, saleId: null, orderId: null, businessPaymentId: { not: null }, itemizedAt: null },
    include: { businessPayment: true },
    orderBy: { issuedAt: 'desc' },
  });
}

export interface AddReceiptItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPriceKes: number;
}

/** Cent-safe equality for two KES amounts computed from floating-point
 *  line totals — the same "compare in the smallest real unit" reasoning
 *  createBusinessPayment's parking-amount check documents. */
function centsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Every raw line validated, then collapsed to one line per
 * (productId, variantId): a client that sends the same item twice
 * (a duplicate tap, a retried submit, or simply two lines for one
 * product) must not cost the shop two independent
 * `stockQty - quantity` writes computed off the same pre-transaction
 * snapshot — that was a real bug (5 in stock, two lines of 3 each,
 * both computing `max(0, 5-3)` off the same snapshot instead of
 * compounding, so stock ends at 2 instead of 0 and nothing is lost to
 * a concurrent write either). Summing quantity per key up front turns
 * "N lines, N stale snapshots" into "one line per item, one write."
 *
 * Rejects a non-positive or non-integer quantity and a negative price
 * outright — nothing upstream of this function is trusted input. A
 * `{quantity: 1, unitPriceKes: -500}` line paired with a `{quantity: 2,
 * unitPriceKes: 500}` line sums to a total that can pass
 * `centsEqual` while describing a receipt with a negative line on it,
 * and a negative quantity makes the stock "decrement" below increase
 * it — both are checked here, not left to the amount-matches-the-total
 * check to catch by accident (it doesn't).
 */
function aggregateAndValidateItems(items: AddReceiptItemInput[]): AddReceiptItemInput[] {
  const byKey = new Map<string, AddReceiptItemInput>();
  for (const i of items) {
    if (!Number.isInteger(i.quantity) || i.quantity <= 0) {
      throw new ReceiptError('Quantity must be a whole number greater than zero', 'BAD_INPUT');
    }
    if (!Number.isFinite(i.unitPriceKes) || i.unitPriceKes < 0) {
      throw new ReceiptError('Price cannot be negative', 'BAD_INPUT');
    }
    const key = `${i.productId}:${i.variantId ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!centsEqual(existing.unitPriceKes, i.unitPriceKes)) {
        throw new ReceiptError('The same item was listed twice at two different prices — combine it into one line', 'BAD_INPUT');
      }
      existing.quantity += i.quantity;
    } else {
      byKey.set(key, { ...i });
    }
  }
  return [...byKey.values()];
}

/**
 * Fills in what a BusinessPayment-backed receipt was actually for, once
 * the shopkeeper knows — matched against their own store's inventory.
 * One-shot, not an editor: claims the receipt via `itemizedAt` before
 * writing anything, and refuses if it's already claimed. "Add what it
 * was for," not "edit this sale," is the whole interaction this is
 * built for (see ItemizeClient in the store dashboard).
 *
 * The `itemizedAt` claim is the actual guard, and it happens inside the
 * same transaction that writes the items — not the `receipt.items.length
 * > 0` read a few lines below, which is a plain read-then-write check
 * outside any transaction and cannot stop two concurrent submits that
 * both read "no items yet" before either has written one. That earlier
 * read stays only as a fast, friendly error for the common case (a
 * merchant double-tapping Done) — see the updateMany below for the part
 * that's actually safe under concurrency.
 *
 * Deliberately posts nothing to the ledger — confirmBusinessPayment
 * already created the JournalEntry crediting this store's revenue the
 * moment the payment was confirmed. This function only ever touches
 * Product/ProductVariant.stockQty, Receipt.itemizedAt and ReceiptItem;
 * re-posting revenue here would double-count money that already moved.
 */
export async function addReceiptItems(ctx: Ctx, receiptId: string, rawItems: AddReceiptItemInput[]) {
  if (rawItems.length === 0) throw new ReceiptError('A receipt needs at least one item', 'BAD_INPUT');
  const items = aggregateAndValidateItems(rawItems);

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, include: { items: true } });
  if (!receipt || !receipt.storeId) throw new ReceiptError('Receipt not found', 'NOT_FOUND');
  const store = await assertOwnsStore(ctx, receipt.storeId, 'receipt.write');
  if (!receipt.businessPaymentId) throw new ReceiptError('This receipt already has its items', 'NOT_ITEMIZABLE');
  if (receipt.itemizedAt || receipt.items.length > 0) throw new ReceiptError('This receipt already has its items', 'ALREADY_ITEMIZED');

  const sum = items.reduce((s, i) => s + i.unitPriceKes * i.quantity, 0);
  if (!centsEqual(sum, Number(receipt.totalKes))) {
    throw new ReceiptError(
      `These items total KES ${sum.toLocaleString('en-KE')}, but KES ${Number(receipt.totalKes).toLocaleString('en-KE')} was paid`,
      'AMOUNT_MISMATCH',
    );
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => Boolean(v)))];
  const [products, variants] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds }, storeId: store.id, status: 'ACTIVE' } }),
    variantIds.length
      ? prisma.productVariant.findMany({ where: { id: { in: variantIds }, product: { storeId: store.id } } })
      : Promise.resolve([]),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  for (const i of items) {
    if (!productById.has(i.productId)) throw new ReceiptError('One of these items is not in your inventory', 'ITEM_UNAVAILABLE');
    if (i.variantId && !variantById.has(i.variantId)) throw new ReceiptError('One of these items is not in your inventory', 'ITEM_UNAVAILABLE');
  }

  await prisma.$transaction(async (tx) => {
    // The actual one-shot guard: exactly one concurrent caller can match
    // this WHERE clause (itemizedAt: null), the same "claim the row
    // before anything else, atomically" pattern confirmBusinessPayment
    // uses on BusinessPayment.status. The loser finds nothing to claim
    // and is told so, instead of both writers reaching the createMany
    // below.
    const claimed = await tx.receipt.updateMany({
      where: { id: receiptId, businessPaymentId: { not: null }, itemizedAt: null },
      data: { itemizedAt: new Date() },
    });
    if (claimed.count === 0) throw new ReceiptError('This receipt already has its items', 'ALREADY_ITEMIZED');

    await tx.receiptItem.createMany({
      data: items.map((i) => ({
        receiptId,
        productId: i.productId,
        variantId: i.variantId ?? null,
        quantity: i.quantity,
        unitPriceKes: i.unitPriceKes,
      })),
    });

    // Stock decrement, clamp-at-zero — same reasoning as recordPosSale:
    // the goods already left the shop when the payment was made, well
    // before anyone opened this screen. Refusing to record a
    // disagreement with the software's count would just make the
    // merchant stop trusting the software, not un-happen the sale.
    // `items` is already aggregated to one line per product/variant
    // (aggregateAndValidateItems above), so each of these writes is the
    // only write against that row in this call — no lost update between
    // two lines for the same item computed off the same stale snapshot.
    for (const i of items) {
      if (i.variantId) {
        const v = variantById.get(i.variantId)!;
        if (v.stockQty !== null) {
          await tx.productVariant.update({ where: { id: i.variantId }, data: { stockQty: Math.max(0, v.stockQty - i.quantity) } });
        }
      } else {
        const p = productById.get(i.productId)!;
        if (p.stockQty !== null) {
          await tx.product.update({ where: { id: i.productId }, data: { stockQty: Math.max(0, p.stockQty - i.quantity) } });
        }
      }
    }
  });

  await recordAudit(ctx, {
    action: 'receipt.itemized',
    targetType: 'receipt',
    targetId: receiptId,
    payload: { storeId: store.id, itemCount: items.length, totalKes: Number(receipt.totalKes) },
  });

  return getReceipt(ctx, receiptId);
}
