import { prisma } from '../client';
import type { Ctx } from '../capabilities';

/* Reference data is public. No capability required — but it still goes
   through the DAL so there is exactly one path to the database. */

export async function listCounties(_ctx: Ctx) {
  return prisma.county.findMany({ orderBy: [{ hasFieldOfficer: 'desc' }, { name: 'asc' }] });
}

export async function getCounty(_ctx: Ctx, code: string) {
  return prisma.county.findUnique({
    where: { code },
    include: { markets: true, permits: { orderBy: { name: 'asc' } } },
  });
}

export async function listPricesForDate(_ctx: Ctx, date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return prisma.priceQuote.findMany({
    where: { quotedFor: day },
    include: { commodity: true, market: { include: { county: true } } },
    orderBy: [{ commodity: { category: 'asc' } }, { commodity: { name: 'asc' } }],
  });
}

/** Markets expected to report today but that have not. Absence is data. */
export async function listMissingQuotes(_ctx: Ctx, date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const reporting = await prisma.market.findMany({
    where: { reporting: true },
    include: { county: true, prices: { where: { quotedFor: day }, take: 1 } },
  });
  return reporting.filter((m) => m.prices.length === 0);
}

export async function listIssuers(_ctx: Ctx) {
  return prisma.issuer.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
}

/* ── public certificate verification ─────────────────────────
   No capability required, by design. A buyer, a bank clerk or a county
   officer must be able to confirm a certificate without an account —
   that portability is what makes a credential worth holding.          */

export interface VerifyResult {
  found: boolean;
  status: 'valid' | 'expiring' | 'expired' | 'revoked';
  claimType: string;
  holder: string;
  issuer: string;
  issuedOn: string;
  validUntil: string | null;
}

const EMPTY: VerifyResult = {
  found: false, status: 'expired', claimType: '', holder: '',
  issuer: '', issuedOn: '', validUntil: null,
};

/* ── public receipt verification ─────────────────────────────
   Same "no capability, by design" reasoning as verifyCertificate right
   below: whoever is holding a receipt — the shopper who paid, a
   support agent, a would-be forger checking their work — must be able
   to confirm it without an account. What it can show is deliberately
   the same information already printed on the paper/SMS copy — never
   a phone number, which stays off this projection entirely. */

export interface VerifyReceiptItem {
  name: string;
  quantity: number;
  unitPriceKes: number;
}

export interface VerifyReceiptResult {
  found: boolean;
  storeName: string;
  /** The printed-slip label — same value the merchant's own copy shows,
   *  and what a VAT-registered merchant's customer typically quotes
   *  back, distinct from the receiptCode this lookup was keyed on. */
  receiptNo: string;
  issuedOn: string;
  totalKes: number;
  items: VerifyReceiptItem[];
  /** True only for a BusinessPayment-backed receipt whose items haven't
   *  been filled in yet — see addReceiptItems in dal/receipt.ts. A
   *  PosSale/StoreOrder receipt is never in this state; it has items
   *  from the moment it's issued.
   *
   *  Keyed on "no sale, no order, no items" rather than
   *  `Boolean(receipt.businessPaymentId)` — BusinessPayment.receipt is
   *  `onDelete: SetNull`, so a deleted payment would otherwise flip
   *  this straight to `false` with an empty items array, which renders
   *  as a plain zero-item receipt instead of "pending." Absence of a
   *  sale/order is the actually-stable signal: it never changes after
   *  issuance. */
  itemsPending: boolean;
  /** Total refunded against the underlying PosSale, when this receipt
   *  is sale-backed and any refund has been recorded. Zero for every
   *  other receipt kind, and zero today for every sale too — nothing in
   *  this codebase writes a PosRefund row yet, so this is always 0
   *  until that lands. Wired now anyway: a receipt is a durable public
   *  URL, and reading refunds here costs nothing, unlike retrofitting
   *  it once real refunds exist and old receipts are already rendering
   *  a bare green checkmark over a sale that was actually reversed. */
  refundedKes: number;
}

const EMPTY_RECEIPT: VerifyReceiptResult = {
  found: false, storeName: '', receiptNo: '', issuedOn: '', totalKes: 0, items: [], itemsPending: false, refundedKes: 0,
};

export async function verifyReceipt(_ctx: Ctx, code: string): Promise<VerifyReceiptResult> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4) return EMPTY_RECEIPT;

  const receipt = await prisma.receipt.findUnique({
    where: { receiptCode: clean },
    include: {
      store: { select: { name: true } },
      sale: { include: { items: { include: { product: true, variant: true } } } },
      order: { include: { items: { include: { product: true } } } },
      items: { include: { product: true, variant: true } },
      businessPayment: { select: { payeeName: true } },
    },
  });
  if (!receipt) return EMPTY_RECEIPT;

  const items: VerifyReceiptItem[] =
    receipt.sale?.items.map((i) => ({
      name: i.variant ? `${i.product.name} — ${i.variant.label}` : i.product.name,
      quantity: i.quantity,
      unitPriceKes: Number(i.unitPriceKes),
    }))
    ?? receipt.order?.items.map((i) => ({
      name: i.product.name,
      quantity: i.quantity,
      unitPriceKes: Number(i.unitPriceKes),
    }))
    ?? receipt.items.map((i) => ({
      name: i.variant ? `${i.product.name} — ${i.variant.label}` : i.product.name,
      quantity: i.quantity,
      unitPriceKes: Number(i.unitPriceKes),
    }));

  const refunded = receipt.saleId
    ? await prisma.posRefund.aggregate({ where: { saleId: receipt.saleId }, _sum: { amountKes: true } })
    : null;

  return {
    found: true,
    storeName: receipt.store?.name ?? receipt.businessPayment?.payeeName ?? 'Esoqo',
    receiptNo: receipt.receiptNo,
    issuedOn: receipt.issuedAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }),
    totalKes: Number(receipt.totalKes),
    items,
    itemsPending: !receipt.saleId && !receipt.orderId && items.length === 0,
    refundedKes: Number(refunded?._sum.amountKes ?? 0),
  };
}

export async function verifyCertificate(_ctx: Ctx, code: string): Promise<VerifyResult> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4) return EMPTY;

  // The printed code is the attestation id's short form. Matching on a
  // prefix keeps the printed code short enough to type on a bad day.
  const prefix = clean.replace(/-/g, '').toLowerCase();
  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM attestation WHERE replace(id::text, '-', '') ILIKE ${prefix + '%'} LIMIT 1
  `;
  const match = matches[0];
  if (!match) return EMPTY;

  const att = await prisma.attestation.findUnique({
    where: { id: match.id },
    include: {
      issuer: true,
      subject: { include: { person: true, organisation: true } },
    },
  });
  if (!att) return EMPTY;

  const now = Date.now();
  const expiresAt = att.expiresAt?.getTime();
  const status: VerifyResult['status'] = att.revokedAt
    ? 'revoked'
    : expiresAt && expiresAt < now
      ? 'expired'
      : expiresAt && expiresAt - now < 60 * 864e5
        ? 'expiring'
        : 'valid';

  const holder =
    att.subject.organisation?.officialName ??
    att.subject.person?.officialName ??
    'Withheld';

  return {
    found: true,
    status,
    claimType: att.claimType.replace(/_/g, ' ').toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase()),
    holder: att.revokedAt ? '[withheld]' : holder,
    issuer: att.issuer?.name ?? 'Esoqo',
    issuedOn: att.issuedAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }),
    validUntil: att.expiresAt
      ? att.expiresAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
      : null,
  };
}
