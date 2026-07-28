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

export async function verifyCertificate(_ctx: Ctx, code: string): Promise<VerifyResult> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4) return EMPTY;

  // The printed code is the attestation id's short form. Matching on a
  // prefix keeps the printed code short enough to type on a bad day.
  const att = await prisma.attestation.findFirst({
    where: { id: { startsWith: clean.replace(/-/g, '').toLowerCase() } },
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
    issuer: att.issuer?.name ?? 'Esoko',
    issuedOn: att.issuedAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }),
    validUntil: att.expiresAt
      ? att.expiresAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
      : null,
  };
}
