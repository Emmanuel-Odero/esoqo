import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { JamiiInterestStatus } from '@prisma/client';

/**
 * "Not yet a CECF member" leads from Our Jamii (apps/jamii).
 *
 * Access to Our Jamii is gated to existing CECF members — a Person
 * record already has to exist (created via the CECF join funnel, see
 * apps/app/src/app/join) before someone can sign in or set a PIN there.
 * Someone who tries and isn't found gets told that plainly and offered
 * this instead of a dead end: leave your details, Esoko staff follow up.
 *
 * Deliberately not a Registration — a Registration implies "this
 * person is mid-funnel toward becoming a Party"; this is "someone was
 * turned away," reviewed from the admin app, not auto-converted.
 */

/** Granted only by apps/jamii's own anonymous request Ctx (mirroring
 *  apps/app/src/app/join/actions.ts's requestCtx) — no staff role should
 *  hold this; it exists so requireCapability still runs on every write,
 *  never "this DAL function trusts its caller unconditionally." */
export const JAMII_INTEREST_CREATE = 'jamii-interest.create';

export interface CreateJamiiInterestInput {
  fullName: string;
  msisdn: string;
  email?: string;
  county?: string;
  organisationName?: string;
  message?: string;
}

export async function createJamiiInterest(ctx: Ctx, input: CreateJamiiInterestInput) {
  requireCapability(ctx, JAMII_INTEREST_CREATE);

  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('A name is required');
  if (!input.msisdn?.trim()) throw new Error('A phone number is required');

  const row = await prisma.jamiiInterest.create({
    data: {
      fullName,
      msisdn: input.msisdn.trim(),
      email: input.email?.trim().toLowerCase() || undefined,
      county: input.county?.trim() || undefined,
      organisationName: input.organisationName?.trim() || undefined,
      message: input.message?.trim() || undefined,
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_interest.created',
    targetType: 'jamii_interest',
    targetId: row.id,
    payload: { msisdn: row.msisdn, county: row.county },
  });

  return row;
}

export interface ListJamiiInterestsFilter {
  status?: JamiiInterestStatus;
  search?: string;
}

export async function listJamiiInterests(ctx: Ctx, filter: ListJamiiInterestsFilter = {}) {
  requireCapability(ctx, 'jamii-interest.read');

  return prisma.jamiiInterest.findMany({
    where: {
      status: filter.status,
      ...(filter.search
        ? {
            OR: [
              { fullName: { contains: filter.search, mode: 'insensitive' } },
              { msisdn: { contains: filter.search } },
              { email: { contains: filter.search, mode: 'insensitive' } },
              { organisationName: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function countNewJamiiInterests(ctx: Ctx): Promise<number> {
  requireCapability(ctx, 'jamii-interest.read');
  return prisma.jamiiInterest.count({ where: { status: 'NEW' } });
}

/**
 * Staff triage — records who actioned it and why, same "reviewer +
 * note" shape as document review elsewhere in the admin app. Does not
 * create a Party; converting a lead into an actual CECF member is a
 * deliberate, separate step (the real join funnel), not a side effect
 * of a status change here.
 */
export async function reviewJamiiInterest(
  ctx: Ctx,
  id: string,
  input: { status: JamiiInterestStatus; reviewNote?: string },
) {
  requireCapability(ctx, 'jamii-interest.write');
  if (!ctx.actorId) throw new Error('Sign in as staff to review an interest submission');

  const row = await prisma.jamiiInterest.update({
    where: { id },
    data: {
      status: input.status,
      reviewNote: input.reviewNote?.trim() || undefined,
      reviewedByStaffId: ctx.actorId,
      reviewedAt: new Date(),
    },
  });

  await recordAudit(ctx, {
    action: 'jamii_interest.reviewed',
    targetType: 'jamii_interest',
    targetId: row.id,
    payload: { status: row.status },
  });

  return row;
}
