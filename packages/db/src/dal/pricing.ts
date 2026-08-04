import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Pricing is data, not code. Every fee shown anywhere in the store
 * wizard or storefront reads one of these rows — nothing is a
 * `process.env` constant or a number written into a component.
 */

export const PRICING_KEYS = [
  'SUBDOMAIN_SETUP_FEE',
  'SUBDOMAIN_MONTHLY_FEE',
  'POS_MONTHLY_FEE',
  'PLATFORM_FEE_PCT',
] as const;

/** Public read — the wizard and storefront need this without a session. */
export async function listPricingRules(_ctx: Ctx) {
  return prisma.pricingRule.findMany({ orderBy: { key: 'asc' } });
}

export async function getPricingRule(_ctx: Ctx, key: string) {
  return prisma.pricingRule.findUnique({ where: { key } });
}

export interface UpdatePricingRuleInput {
  amountKes?: number | null;
  amountPct?: number | null;
}

export async function updatePricingRule(ctx: Ctx, key: string, input: UpdatePricingRuleInput) {
  requireCapability(ctx, 'pricing.write');
  if (!ctx.actorId) throw new Error('Pricing changes require a named staff account');

  const rule = await prisma.pricingRule.update({
    where: { key },
    data: { amountKes: input.amountKes, amountPct: input.amountPct, updatedById: ctx.actorId },
  });

  await recordAudit(ctx, {
    action: 'pricing_rule.updated',
    targetType: 'pricing_rule',
    targetId: rule.id,
    payload: { key, amountKes: input.amountKes, amountPct: input.amountPct },
  });

  return rule;
}
