import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { normaliseMsisdn } from '@esoko/domain';
import type { MemberRole, OrgKind } from '@prisma/client';

/** Group membership management from the admin side. */

export const GROUP_KINDS = [
  ['CHAMA', 'Chama'],
  ['SELF_HELP_GROUP', 'Self-help group'],
  ['TABLE_BANKING', 'Table banking'],
  ['WELFARE_GROUP', 'Welfare group'],
  ['CBO', 'Community-based organisation'],
  ['FBO', 'Faith-based organisation'],
  ['COOPERATIVE', 'Cooperative'],
  ['SACCO', 'SACCO'],
  ['NGO', 'NGO'],
  ['BUSINESS', 'Business'],
  ['SCHOOL', 'School'],
  ['CLINIC', 'Clinic'],
  ['MARKET_ASSOCIATION', 'Market association'],
  ['OTHER', 'Other'],
] as const;

/**
 * Registers a group from the admin side — for staff working off a paper
 * roster or onboarding a group that never went through the self-serve
 * join flow. Creates the Party + Organisation and, unlike the join flow,
 * has no founding member attached yet; staff add members afterwards the
 * same way as for any other group.
 */
export async function createGroup(
  ctx: Ctx,
  input: {
    kind: OrgKind; officialName: string; knownAs?: string; county: string;
    ward?: string; registrationNo?: string; memberCount?: number; formedOn?: Date;
  },
) {
  requireCapability(ctx, 'party.write');

  const officialName = input.officialName.trim();
  if (!officialName) throw new Error('A group name is required');
  if (!input.county) throw new Error('A county is required');

  const party = await prisma.party.create({
    data: {
      kind: 'ORGANISATION',
      county: input.county,
      ward: input.ward || null,
      organisation: {
        create: {
          kind: input.kind,
          officialName,
          knownAs: input.knownAs?.trim() || null,
          registrationNo: input.registrationNo?.trim() || null,
          memberCount: input.memberCount ?? null,
          formedOn: input.formedOn ?? null,
        },
      },
      accounts: { create: [{ kind: 'GROUP_SAVINGS', currency: 'KES' }] },
    },
    include: { organisation: true },
  });

  await recordAudit(ctx, {
    action: 'group.created', targetType: 'organisation', targetId: party.id,
    payload: { kind: input.kind, officialName, county: input.county },
  });

  return party;
}

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

/** OTHER carries whatever the group actually calls the role; any other
 *  value means customRole is stale and must not linger in the row. */
function resolveCustomRole(role: MemberRole, customRole?: string): string | null {
  if (role !== 'OTHER') return null;
  const trimmed = customRole?.trim();
  if (!trimmed) throw new Error('Enter what this role is called');
  return trimmed;
}

/** Add an existing person to a group. Idempotent — re-adding someone who
 *  left reinstates them rather than creating a second membership. */
export async function addMember(
  ctx: Ctx, orgPartyId: string, personPartyId: string,
  role: MemberRole = 'MEMBER', customRole?: string,
) {
  requireCapability(ctx, 'membership.write', { partyId: orgPartyId });
  const resolvedCustomRole = resolveCustomRole(role, customRole);

  const existing = await prisma.membership.findUnique({
    where: { personId_orgId: { personId: personPartyId, orgId: orgPartyId } },
  });

  const m = existing
    ? await prisma.membership.update({
        where: { id: existing.id }, data: { exitedAt: null, role, customRole: resolvedCustomRole },
      })
    : await prisma.membership.create({
        data: { personId: personPartyId, orgId: orgPartyId, role, customRole: resolvedCustomRole },
      });

  await recordAudit(ctx, {
    action: existing ? 'membership.reinstated' : 'membership.added',
    targetType: 'membership', targetId: m.id,
    payload: { orgPartyId, personPartyId, role, customRole: resolvedCustomRole },
  });
  return m;
}

/**
 * Creates a brand-new person and adds them to a group in one step, for
 * staff filling in a member list from a paper roster where not everyone
 * has a phone number to hand. Phone is optional: a person added without
 * one is "pending" — they show up as a member immediately, but can't log
 * in, dial USSD or receive SMS until a real number is added later.
 *
 * The phone is normalised to E.164 and validated with the same rules as
 * every other number in the product, so a typo can never strand a member
 * on a number they can't verify or sign in with. If the number already
 * belongs to someone on Esoko, staff are told to search for them instead
 * of duplicating a person.
 */
export async function addNewMember(
  ctx: Ctx, orgPartyId: string,
  input: { officialName: string; msisdn?: string },
  role: MemberRole = 'MEMBER', customRole?: string,
) {
  requireCapability(ctx, 'party.write', { partyId: orgPartyId });
  requireCapability(ctx, 'membership.write', { partyId: orgPartyId });
  const resolvedCustomRole = resolveCustomRole(role, customRole);

  const officialName = input.officialName.trim();
  if (!officialName) throw new Error('A name is required');

  let msisdn: string | null = null;
  if (input.msisdn?.trim()) {
    msisdn = normaliseMsisdn(input.msisdn);
    if (!msisdn) {
      throw new Error('That does not look like a Kenyan mobile number — try the format 07XX XXX XXX');
    }
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
      data: { personId: party.id, orgId: orgPartyId, role, customRole: resolvedCustomRole },
    });
    await recordAudit(ctx, {
      action: 'membership.added_new_person', targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personId: party.id, role, customRole: resolvedCustomRole, hasPhone: Boolean(msisdn) },
    }, tx as never);
    return m;
  });
}

/**
 * Corrects a member's phone number on file — the remediation path for a
 * member whose number was added wrong (typo, placeholder, missing), which
 * otherwise strands them: a number that fails the E.164 rules can never
 * be verified, so they can never set a PIN or sign in, and any real
 * number they later register under lands on a brand-new party with no
 * membership. Staff fix the number here; the member then sets a PIN with
 * their own handset and their membership shows up.
 *
 * Guarded like addNewMember (party.write), and the new number must be a
 * valid Kenyan mobile that no other person on Esoko already has. Clearing
 * msisdnVerifiedAt is deliberate: a staff-typed number has not been
 * verified by the member through an OTP flow.
 */
export async function updateMemberPhone(ctx: Ctx, membershipId: string, raw: string) {
  requireCapability(ctx, 'party.write');

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { personId: true },
  });
  if (!membership) throw new Error('Member not found');

  const msisdn = normaliseMsisdn(raw);
  if (!msisdn) {
    throw new Error('That does not look like a Kenyan mobile number — try the format 07XX XXX XXX');
  }

  const clash = await prisma.person.findFirst({
    where: { msisdn, partyId: { not: membership.personId } },
  });
  if (clash) throw new Error('Someone else is already on Esoko with that number');

  const person = await prisma.person.update({
    where: { partyId: membership.personId },
    data: { msisdn, msisdnVerifiedAt: null },
  });

  await recordAudit(ctx, {
    action: 'membership.phone_corrected',
    targetType: 'membership', targetId: membershipId,
    payload: { personId: membership.personId, msisdn },
  });

  return person;
}

export async function setMemberRole(
  ctx: Ctx, membershipId: string, role: MemberRole, customRole?: string,
) {
  requireCapability(ctx, 'membership.write');
  const resolvedCustomRole = resolveCustomRole(role, customRole);
  const m = await prisma.membership.update({
    where: { id: membershipId }, data: { role, customRole: resolvedCustomRole },
  });
  await recordAudit(ctx, {
    action: 'membership.role_changed', targetType: 'membership', targetId: membershipId,
    payload: { role, customRole: resolvedCustomRole },
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

/** The OrgKind values that stand for the "a group" path on /join — every
 *  kind except BUSINESS, which gets its own dedicated search/onboarding
 *  path even though it is, mechanically, just another OrgKind. */
export const JOINABLE_GROUP_KINDS = GROUP_KINDS
  .map(([k]) => k)
  .filter((k) => k !== 'BUSINESS') as OrgKind[];

/**
 * Shared implementation behind both searchGroupsPublic and
 * searchBusinessesPublic — anonymous, name-only, no members, no PII.
 * Lets a joiner link to a real Organisation instead of typing a name
 * that goes nowhere, whichever OrgKind subset they're searching.
 */
async function searchOrganisationsPublic(
  ctx: Ctx, q: string, opts: { kinds: readonly OrgKind[]; county?: string },
) {
  requireCapability(ctx, 'party.read:public');
  if (q.trim().length < 2) return [];
  const rows = await prisma.organisation.findMany({
    where: {
      kind: { in: opts.kinds as OrgKind[] },
      party: { deletedAt: null, ...(opts.county ? { county: opts.county } : {}) },
      OR: [
        { officialName: { contains: q, mode: 'insensitive' as const } },
        { knownAs: { contains: q, mode: 'insensitive' as const } },
      ],
    },
    include: { party: { select: { county: true, subCounty: true, district: true } } },
    take: 8,
  });
  return rows.map((r) => ({
    id: r.partyId,
    name: r.knownAs || r.officialName,
    county: r.party.county,
    subCounty: r.party.subCounty,
    district: r.party.district,
  }));
}

/** Public group search for the anonymous join flow. */
export async function searchGroupsPublic(ctx: Ctx, q: string, county?: string) {
  return searchOrganisationsPublic(ctx, q, { kinds: JOINABLE_GROUP_KINDS, county });
}

/** Public business search for the anonymous join flow's business path —
 *  the same search-before-create mechanism as groups, scoped to
 *  OrgKind.BUSINESS, so a joiner can't accidentally register a business
 *  that's already on Esoko under a slightly different spelling. */
export async function searchBusinessesPublic(ctx: Ctx, q: string, county?: string) {
  return searchOrganisationsPublic(ctx, q, { kinds: ['BUSINESS'], county });
}

/**
 * Private "am I already listed?" check for the join flow. Never returns
 * another member's name or phone — only whether *this* searcher's own
 * phone or name matches someone already on the roster, so a stranger
 * can't scrape a group's membership through the public join form.
 *
 * - A phone number is checked for an exact match against any active
 *   member (the searcher already knows their own number, so confirming
 *   it back is not a leak).
 * - A name is only matched against *pending* members (added by staff
 *   from a paper roster, no phone on file yet — see addNewMember) and
 *   only counts as a match when it resolves to exactly one person;
 *   an ambiguous match returns unmatched rather than guess. This lets
 *   someone "claim" a pending slot by supplying their phone during
 *   the OTP-verified rest of the join flow, without ever exposing who
 *   else is on the list.
 */
export async function checkGroupMembership(
  ctx: Ctx, orgPartyId: string, input: { name?: string; msisdn?: string },
): Promise<{ matched: boolean; personId?: string }> {
  requireCapability(ctx, 'party.read:public');

  const msisdn = input.msisdn?.trim();
  if (msisdn) {
    const hit = await prisma.membership.findFirst({
      where: {
        orgId: orgPartyId, exitedAt: null,
        person: { person: { msisdn } },
      },
      select: { personId: true },
    });
    if (hit) return { matched: true, personId: hit.personId };
  }

  const name = input.name?.trim();
  if (name && name.length >= 2) {
    const hits = await prisma.membership.findMany({
      where: {
        orgId: orgPartyId, exitedAt: null,
        person: { person: { msisdn: null, officialName: { contains: name, mode: 'insensitive' as const } } },
      },
      select: { personId: true },
      take: 2,
    });
    if (hits.length === 1 && hits[0]) return { matched: true, personId: hits[0].personId };
  }

  return { matched: false };
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
