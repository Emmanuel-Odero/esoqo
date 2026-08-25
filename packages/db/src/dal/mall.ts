import { prisma } from '../client';
import { requireCapability, AuthorisationError, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Mall tenancy — a mall Organisation hosting other merchants' stores.
 *
 * The tenant side is an Enterprise, not an Organisation (same reasoning
 * Store and TicketOrg already follow: the economic unit does the
 * transacting, not the identity record above it). Ending a tenancy is a
 * soft exit (endedAt), same reinstate-not-delete shape addMember uses
 * for Membership.
 */

export class MallError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'BAD_INPUT') {
    super(msg);
    this.name = 'MallError';
  }
}

/**
 * Staff holding the plain mall.write capability may manage any mall.
 * A subject only holds mall.write:own — which, like store.write:own,
 * only confirms they're acting as themselves — so for them this
 * additionally requires an active membership at the mall Organisation.
 * biz-path registration only ever creates one membership on a mall org
 * (role OTHER, customRole "Owner" — see completeRegistration), so
 * "any active membership" is the actual ownership signal here, not an
 * officer-role check like requireGroupOfficer's (chama-shaped roster).
 */
async function requireMallOfficer(ctx: Ctx, mallOrgId: string) {
  requireCapability(ctx, 'mall.write', { partyId: ctx.partyId });
  if (ctx.actorType === 'STAFF') return;
  if (!ctx.partyId) throw new AuthorisationError('mall.write', ctx);
  const m = await prisma.membership.findFirst({
    where: { orgId: mallOrgId, personId: ctx.partyId, exitedAt: null, status: 'ACTIVE' },
  });
  if (!m) throw new AuthorisationError('mall.write', ctx);
}

async function assertIsMall(mallOrgId: string) {
  const org = await prisma.organisation.findUnique({ where: { partyId: mallOrgId }, select: { kind: true } });
  if (!org) throw new MallError('Mall not found', 'NOT_FOUND');
  if (org.kind !== 'MALL') throw new MallError('That organisation is not a mall', 'BAD_INPUT');
}

/** Adds (or reinstates a previously-ended) tenancy — idempotent on the
 *  (mallOrgId, tenantEnterpriseId) pair, same shape as addMember. */
export async function addTenant(
  ctx: Ctx, mallOrgId: string, tenantEnterpriseId: string, unitLabel?: string,
) {
  await requireMallOfficer(ctx, mallOrgId);
  await assertIsMall(mallOrgId);

  const enterprise = await prisma.enterprise.findUnique({ where: { id: tenantEnterpriseId } });
  if (!enterprise) throw new MallError('Enterprise not found', 'NOT_FOUND');

  const existing = await prisma.mallTenancy.findUnique({
    where: { mallOrgId_tenantEnterpriseId: { mallOrgId, tenantEnterpriseId } },
  });

  const t = existing
    ? await prisma.mallTenancy.update({
        where: { id: existing.id }, data: { endedAt: null, unitLabel: unitLabel ?? existing.unitLabel },
      })
    : await prisma.mallTenancy.create({
        data: { mallOrgId, tenantEnterpriseId, unitLabel: unitLabel || null },
      });

  await recordAudit(ctx, {
    action: existing ? 'mall_tenancy.reinstated' : 'mall_tenancy.added',
    targetType: 'mall_tenancy', targetId: t.id,
    payload: { mallOrgId, tenantEnterpriseId, unitLabel },
  });
  return t;
}

export async function endTenancy(ctx: Ctx, tenancyId: string, reason?: string) {
  const existing = await prisma.mallTenancy.findUnique({ where: { id: tenancyId } });
  if (!existing) throw new MallError('Tenancy not found', 'NOT_FOUND');
  await requireMallOfficer(ctx, existing.mallOrgId);

  const t = await prisma.mallTenancy.update({ where: { id: tenancyId }, data: { endedAt: new Date() } });
  await recordAudit(ctx, {
    action: 'mall_tenancy.ended', targetType: 'mall_tenancy', targetId: tenancyId, payload: { reason },
  });
  return t;
}

/** Sets (or clears) the slug a mall's public tenant directory is served
 *  at — /m/[mallSlug]. Staff-only for now, same as other identity-field
 *  edits on an Organisation (there's no self-serve equivalent yet). */
export async function setMallSlug(ctx: Ctx, mallOrgId: string, slug: string | null) {
  requireCapability(ctx, 'mall.write');
  await assertIsMall(mallOrgId);

  if (slug) {
    const trimmed = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,60}$/.test(trimmed)) {
      throw new MallError('Slug must be 3-60 lowercase letters, numbers or dashes', 'BAD_INPUT');
    }
    const clash = await prisma.organisation.findFirst({
      where: { mallSlug: trimmed, NOT: { partyId: mallOrgId } },
    });
    if (clash) throw new MallError('That slug is already taken', 'BAD_INPUT');
    const org = await prisma.organisation.update({ where: { partyId: mallOrgId }, data: { mallSlug: trimmed } });
    await recordAudit(ctx, { action: 'mall.slug_set', targetType: 'organisation', targetId: mallOrgId, payload: { slug: trimmed } });
    return org;
  }

  const org = await prisma.organisation.update({ where: { partyId: mallOrgId }, data: { mallSlug: null } });
  await recordAudit(ctx, { action: 'mall.slug_cleared', targetType: 'organisation', targetId: mallOrgId, payload: {} });
  return org;
}

/** A mall's own management view — active and past tenants. */
export async function listTenants(ctx: Ctx, mallOrgId: string) {
  await requireMallOfficer(ctx, mallOrgId);
  return prisma.mallTenancy.findMany({
    where: { mallOrgId },
    include: {
      tenantEnterprise: {
        select: {
          workRaw: true,
          stores: { select: { id: true, name: true, slug: true, status: true } },
        },
      },
    },
    orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
  });
}

/** Public tenant directory — /m/[mallSlug]. Active tenancies only,
 *  each resolved down to its active Store (a tenant with no live store
 *  yet just doesn't show up), mirroring getStoreBySlug's shape. */
export async function getMallBySlug(_ctx: Ctx, slug: string) {
  const mall = await prisma.organisation.findFirst({
    where: { mallSlug: slug, kind: 'MALL' },
    select: {
      partyId: true, officialName: true, knownAs: true,
      party: { select: { county: true } },
    },
  });
  if (!mall) return null;

  const tenancies = await prisma.mallTenancy.findMany({
    where: { mallOrgId: mall.partyId, endedAt: null },
    include: {
      tenantEnterprise: {
        select: {
          stores: {
            where: { status: 'ACTIVE' },
            select: { id: true, name: true, slug: true, tagline: true },
            take: 1,
          },
        },
      },
    },
  });

  const tenants = tenancies
    .map((t) => ({ unitLabel: t.unitLabel, store: t.tenantEnterprise.stores[0] ?? null }))
    .filter((t) => t.store !== null);

  return { ...mall, tenants };
}
