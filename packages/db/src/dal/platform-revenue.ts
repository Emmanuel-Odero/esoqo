import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';

/**
 * Platform-wide revenue, normalised across every payment-bearing model —
 * Donation, StoreOrder, PosSale, RegistrationPayment, GroupContribution,
 * Booking — none of which agree on a payment-method enum today (see
 * dal/store.ts's own StoreOrderPaymentMethod/PosPaymentMethod split).
 *
 * Deliberately reports two different numbers, never blended:
 *   gmvKes      — everything that moved through Esoko. Proves the
 *                 platform matters.
 *   esokoTakeKes — Esoko's own commission, which today is earned ONLY
 *                 on store commerce (PricingRule PLATFORM_FEE_PCT, same
 *                 rule getEstoreOverview already reads). Donations,
 *                 chama contributions and registration fees pass
 *                 through at 100% to the org/group — reporting them as
 *                 "income" overstates the business.
 */
type MethodBucket = 'MPESA' | 'CASH' | 'CARD' | 'OTHER';

export interface PlatformRevenueSplit {
  gmvKes: number;
  esokoTakeKes: number;
  byMethod: Record<MethodBucket, number>;
  bySource: {
    storeCommerce: number;
    ourJamiiGiving: number;
    chamaTreasury: number;
    registrations: number;
    ticketing: number;
  };
}

function bucketFor(method: string | null | undefined): MethodBucket {
  if (!method) return 'OTHER';
  if (method.includes('MPESA')) return 'MPESA';
  if (method === 'CASH' || method === 'CASH_ON_DELIVERY' || method === 'CASH_TO_AGENT') return 'CASH';
  if (method === 'CARD' || method === 'BANK_TRANSFER') return 'CARD';
  return 'OTHER';
}

export async function getPlatformRevenueSplit(ctx: Ctx, days = 30): Promise<PlatformRevenueSplit> {
  requireCapability(ctx, 'report.read');
  const since = new Date(Date.now() - days * 864e5);

  const [orders, posSales, donations, contributions, regPayments, bookings, feeRule] = await Promise.all([
    prisma.storeOrder.findMany({
      where: { status: { in: ['PAID', 'FULFILLED'] }, paidAt: { gte: since } },
      select: { totalKes: true, paymentMethod: true },
    }),
    prisma.posSale.findMany({
      where: { status: 'COMPLETED', soldAt: { gte: since } },
      select: { totalKes: true, paymentMethod: true },
    }),
    prisma.donation.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { gte: since } },
      select: { amountKes: true },
    }),
    prisma.groupContribution.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { gte: since } },
      select: { amountKes: true, method: true },
    }),
    prisma.registrationPayment.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { gte: since } },
      select: { amountKes: true, method: true },
    }),
    prisma.booking.findMany({
      where: { status: 'PAID', paidAt: { gte: since } },
      select: { totalKes: true, paymentMethod: true },
    }),
    prisma.pricingRule.findUnique({ where: { key: 'PLATFORM_FEE_PCT' } }),
  ]);

  const byMethod: Record<MethodBucket, number> = { MPESA: 0, CASH: 0, CARD: 0, OTHER: 0 };
  const add = (kes: number, method: string | null | undefined) => { byMethod[bucketFor(method)] += kes; };

  let storeCommerce = 0, ourJamiiGiving = 0, chamaTreasury = 0, registrations = 0, ticketing = 0;

  for (const o of orders) { const v = Number(o.totalKes); storeCommerce += v; add(v, o.paymentMethod); }
  for (const p of posSales) { const v = Number(p.totalKes); storeCommerce += v; add(v, p.paymentMethod); }
  for (const d of donations) { const v = Number(d.amountKes); ourJamiiGiving += v; add(v, 'MPESA'); }
  for (const c of contributions) { const v = Number(c.amountKes); chamaTreasury += v; add(v, c.method); }
  for (const r of regPayments) { const v = Number(r.amountKes ?? 0); registrations += v; add(v, r.method); }
  for (const b of bookings) { const v = Number(b.totalKes); ticketing += v; add(v, b.paymentMethod); }

  const platformFeePct = feeRule?.amountPct ? Number(feeRule.amountPct) : 0;

  return {
    gmvKes: storeCommerce + ourJamiiGiving + chamaTreasury + registrations + ticketing,
    esokoTakeKes: storeCommerce * (platformFeePct / 100),
    byMethod,
    bySource: { storeCommerce, ourJamiiGiving, chamaTreasury, registrations, ticketing },
  };
}
