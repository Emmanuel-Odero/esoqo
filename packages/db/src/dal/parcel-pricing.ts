import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Parcel dispatch pricing — the "Standard Parcel Pricing Framework"
 * rate card, admin-editable per ParcelType, same "pricing is data, not
 * code" reasoning ./pricing.ts already follows for platform fees. Read
 * by core-go's dbx.GetParcelPricing at booking time; this DAL is the
 * sole writer (shared-table-different-writer split, same as Parcel
 * itself — Go writes parcel rows, Prisma/admin writes this config).
 */

export interface BargainReason {
  reason: string;
  extraDiscountPct: number;
}

/** Public read — the mobile booking flow needs this without a session
 *  (core-go's GET /v1/parcels/pricing reads the table directly; this
 *  is only for the admin editor). */
export async function listParcelPricingRules(_ctx: Ctx) {
  return prisma.parcelPricingRule.findMany({
    where: { parcelOrgId: null },
    orderBy: { parcelType: 'asc' },
  });
}

export interface UpdateParcelPricingRuleInput {
  weightLabel: string;
  minWeightKg: number;
  maxWeightKg: number;
  minKes: number;
  maxKes: number;
  bargainMinPct: number;
  bargainMaxPct: number;
  bargainReasons: BargainReason[];
  /** Hours after payment this type is promised delivered by — copied
   *  onto Parcel.slaDeadlineAt at BOOKED time (see core-go's
   *  ConfirmParcelPaymentByCheckoutID/PayParcelWithPoints). Null/undefined
   *  means no SLA tracked for this type. */
  slaHours?: number | null;
}

export async function updateParcelPricingRule(ctx: Ctx, parcelType: string, input: UpdateParcelPricingRuleInput) {
  requireCapability(ctx, 'parcel_pricing.write');
  if (!ctx.actorId) throw new Error('Pricing changes require a named staff account');
  if (input.minKes <= 0 || input.maxKes < input.minKes) {
    throw new Error('minKes must be positive and maxKes must be at least minKes');
  }
  if (input.minWeightKg < 0 || input.maxWeightKg <= input.minWeightKg) {
    throw new Error('minWeightKg must be 0 or more, and maxWeightKg must be greater than minWeightKg');
  }
  if (input.bargainMinPct < 0 || input.bargainMaxPct < input.bargainMinPct || input.bargainMaxPct > 100) {
    throw new Error('Bargain percentages must be 0-100, with min at or below max');
  }
  if (input.slaHours != null && input.slaHours <= 0) {
    throw new Error('SLA hours must be positive, or left blank for no SLA');
  }

  // parcelType alone stopped being unique when rate cards became
  // per-company: the constraint is now (parcelOrgId, parcelType), and a
  // bare `where: { parcelType }` only typechecked because of an `as
  // never` cast that outlived the schema it was written against.
  //
  // This function edits the *platform* card — the one every parcel is
  // priced against unless a courier company has its own tariff, which
  // is set elsewhere (see setCourierTariff). So it scopes to the rows
  // with no owning company. Resolved to an id first rather than
  // expressed as a compound-unique lookup because Prisma cannot match
  // NULL through a compound unique, and NULL is precisely the platform
  // card's identity here.
  const platformRule = await prisma.parcelPricingRule.findFirst({
    where: { parcelType: parcelType as never, parcelOrgId: null },
    select: { id: true },
  });
  if (!platformRule) {
    throw new Error(`No platform rate card exists for ${parcelType}`);
  }

  const rule = await prisma.parcelPricingRule.update({
    where: { id: platformRule.id },
    data: {
      weightLabel: input.weightLabel,
      minWeightKg: input.minWeightKg,
      maxWeightKg: input.maxWeightKg,
      minKes: input.minKes,
      maxKes: input.maxKes,
      bargainMinPct: input.bargainMinPct,
      bargainMaxPct: input.bargainMaxPct,
      bargainReasons: input.bargainReasons as never,
      slaHours: input.slaHours ?? null,
      updatedById: ctx.actorId,
    },
  });

  await recordAudit(ctx, {
    action: 'parcel_pricing_rule.updated',
    targetType: 'parcel_pricing_rule',
    targetId: rule.id,
    payload: { parcelType, ...input },
  });

  return rule;
}
