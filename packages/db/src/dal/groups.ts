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

/**
 * Creates a brand-new person and adds them to a group in one step, for
 * staff filling in a member list from a paper roster where not everyone
 * has a phone number to hand. Phone is optional: a person added without
 * one is "pending" — they show up as a member immediately, but can't log
 * in, dial USSD or receive SMS until a real number is added later.
 */
export async function addNewMember(
  ctx: Ctx, orgPartyId: string,
  input: { officialName: string; msisdn?: string },
  role: MemberRole = 'MEMBER',
) {
  requireCapability(ctx, 'party.write', { partyId: orgPartyId });
  requireCapability(ctx, 'membership.write', { partyId: orgPartyId });

  const officialName = input.officialName.trim();
  if (!officialName) throw new Error('A name is required');
  const msisdn = input.msisdn?.trim() || null;

  if (msisdn) {
    const clash = await prisma.person.findUnique({ where: { msisdn } });
    if (clash) throw new Error('Someone is already on Esoko with that phone number — search for them instead');
  }

  const org = await prisma.organisation.findUniqueOrThrow({
    where: { partyId: orgPartyId }, select: { party: { select: { county: true } } },
  });

  return prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        kind: 'PERSON', county: org.party.county,
        person: { create: { officialName, msisdn } },
      },
    });
    const m = await tx.membership.create({
      data: { personId: party.id, orgId: orgPartyId, role },
    });
    await recordAudit(ctx, {
      action: 'membership.added_new_person', targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personId: party.id, role, hasPhone: Boolean(msisdn) },
    }, tx as never);
    return m;
  });
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

/** Public group search for the anonymous join flow — name and county only,
 *  no members, no PII. Lets a joiner link to a real group instead of just
 *  typing a name that goes nowhere. */
export async function searchGroupsPublic(ctx: Ctx, q: string) {
  requireCapability(ctx, 'party.read:public');
  if (q.trim().length < 2) return [];
  const rows = await prisma.organisation.findMany({
    where: {
      party: { deletedAt: null },
      OR: [
        { officialName: { contains: q, mode: 'insensitive' as const } },
        { knownAs: { contains: q, mode: 'insensitive' as const } },
      ],
    },
    include: { party: { select: { county: true } } },
    take: 8,
  });
  return rows.map((r) => ({
    id: r.partyId,
    name: r.knownAs || r.officialName,
    county: r.party.county,
  }));
}

/** Staff-facing group search — same lean shape as searchGroupsPublic, but
 *  gated by the ordinary staff `party.read` capability rather than the
 *  anonymous join flow's `party.read:public`. */
export async function searchGroupsForStaff(ctx: Ctx, q: string) {
  requireCapability(ctx, 'party.read');
  if (q.trim().length < 2) return [];
  const rows = await prisma.organisation.findMany({
    where: {
      party: { deletedAt: null },
      OR: [
        { officialName: { contains: q, mode: 'insensitive' as const } },
        { knownAs: { contains: q, mode: 'insensitive' as const } },
      ],
    },
    include: { party: { select: { county: true } } },
    take: 8,
  });
  return rows.map((r) => ({
    id: r.partyId,
    name: r.knownAs || r.officialName,
    county: r.party.county,
  }));
}

/**
 * Assigns or moves a person into a group. The product rule is "one group
 * at a time" even though the schema itself allows more, so any other
 * active membership is soft-exited first — same audit trail as a normal
 * removal, just bundled with the add in one transaction.
 */
export async function assignPersonToGroup(
  ctx: Ctx, personPartyId: string, orgPartyId: string, role: MemberRole = 'MEMBER',
) {
  requireCapability(ctx, 'membership.write', { partyId: orgPartyId });

  return prisma.$transaction(async (tx) => {
    const others = await tx.membership.findMany({
      where: { personId: personPartyId, exitedAt: null, orgId: { not: orgPartyId } },
    });
    for (const m of others) {
      await tx.membership.update({ where: { id: m.id }, data: { exitedAt: new Date() } });
      await recordAudit(ctx, {
        action: 'membership.removed', targetType: 'membership', targetId: m.id,
        payload: { reason: 'Moved to another group' },
      }, tx as never);
    }

    const existing = await tx.membership.findUnique({
      where: { personId_orgId: { personId: personPartyId, orgId: orgPartyId } },
    });
    const m = existing
      ? await tx.membership.update({ where: { id: existing.id }, data: { exitedAt: null, role } })
      : await tx.membership.create({ data: { personId: personPartyId, orgId: orgPartyId, role } });

    await recordAudit(ctx, {
      action: existing ? 'membership.reinstated' : 'membership.added',
      targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personPartyId, role },
    }, tx as never);

    return m;
  });
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
