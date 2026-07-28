import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { MemberRole } from '@prisma/client';

/** Group membership management from the admin side. */

export async function listGroups(ctx: Ctx, f: { search?: string; county?: string } = {}) {
  requireCapability(ctx, 'party.read', { county: f.county });
  return prisma.organisation.findMany({
    where: {
      ...(f.county ? { party: { county: f.county } } : {}),
      ...(f.search
        ? { officialName: { contains: f.search, mode: 'insensitive' as const } }
        : {}),
    },
    include: {
      party: true,
      members: { where: { exitedAt: null }, include: { person: { include: { person: true } } } },
      _count: { select: { members: true } },
    },
    orderBy: { party: { createdAt: 'desc' } },
    take: 50,
  });
}

export async function getGroup(ctx: Ctx, orgPartyId: string) {
  requireCapability(ctx, 'party.read', { partyId: orgPartyId });
  return prisma.organisation.findFirst({
    where: { partyId: orgPartyId },
    include: {
      party: true,
      members: {
        where: { exitedAt: null },
        include: { person: { include: { person: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });
}

/** Add an existing person to a group. Idempotent — re-adding someone who
 *  left reinstates them rather than creating a second membership. */
export async function addMember(
  ctx: Ctx, orgPartyId: string, personPartyId: string, role: MemberRole = 'MEMBER',
) {
  requireCapability(ctx, 'membership.write', { partyId: orgPartyId });

  const existing = await prisma.membership.findUnique({
    where: { personId_orgId: { personId: personPartyId, orgId: orgPartyId } },
  });

  const m = existing
    ? await prisma.membership.update({
        where: { id: existing.id }, data: { exitedAt: null, role },
      })
    : await prisma.membership.create({
        data: { personId: personPartyId, orgId: orgPartyId, role },
      });

  await recordAudit(ctx, {
    action: existing ? 'membership.reinstated' : 'membership.added',
    targetType: 'membership', targetId: m.id,
    payload: { orgPartyId, personPartyId, role },
  });
  return m;
}

export async function setMemberRole(ctx: Ctx, membershipId: string, role: MemberRole) {
  requireCapability(ctx, 'membership.write');
  const m = await prisma.membership.update({ where: { id: membershipId }, data: { role } });
  await recordAudit(ctx, {
    action: 'membership.role_changed', targetType: 'membership', targetId: membershipId,
    payload: { role },
  });
  return m;
}

/** Soft exit. A member who leaves keeps their contribution history. */
export async function removeMember(ctx: Ctx, membershipId: string, reason: string) {
  requireCapability(ctx, 'membership.write');
  const m = await prisma.membership.update({
    where: { id: membershipId }, data: { exitedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'membership.removed', targetType: 'membership', targetId: membershipId,
    payload: { reason },
  });
  return m;
}

/** People not yet in this group, for the add-member picker. */
export async function searchAddablePeople(ctx: Ctx, orgPartyId: string, q: string) {
  requireCapability(ctx, 'party.read');
  if (q.trim().length < 2) return [];
  const current = await prisma.membership.findMany({
    where: { orgId: orgPartyId, exitedAt: null }, select: { personId: true },
  });
  const exclude = current.map((c) => c.personId);
  return prisma.party.findMany({
    where: {
      kind: 'PERSON', deletedAt: null, id: { notIn: exclude },
      OR: [
        { person: { officialName: { contains: q, mode: 'insensitive' } } },
        { person: { knownAs: { contains: q, mode: 'insensitive' } } },
        { person: { msisdn: { contains: q } } },
      ],
    },
    include: { person: true },
    take: 8,
  });
}
