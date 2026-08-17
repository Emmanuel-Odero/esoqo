import { prisma } from '../client';
import { requireCapability, AuthorisationError, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { normaliseMsisdn } from '@esoko/domain';
import type { MemberRole, OrgKind } from '@prisma/client';

/** Group membership management — both the admin side (staff, unqualified
 *  membership.write) and the self-serve side (a group's own officers,
 *  membership.write:own on SUBJECT). requireGroupOfficer below is what
 *  lets addMember/addNewMember/setMemberRole/removeMember/inviteMember
 *  serve both without duplicating each one. */

const OFFICER_ROLES: MemberRole[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY'];

/**
 * Staff holding the plain membership.write capability (no qualifier)
 * may act on any group, same as every other admin tool here. A subject
 * only holds membership.write:own — which, like group.create:own, only
 * confirms they're acting as themselves — so for them this additionally
 * requires being one of orgId's own officers, the same check
 * dal/treasury.ts's isOfficer makes before letting someone change
 * treasury policy or signers.
 */
async function requireGroupOfficer(ctx: Ctx, orgId: string) {
  requireCapability(ctx, 'membership.write', { partyId: ctx.partyId });
  if (ctx.actorType === 'STAFF') return;
  if (!ctx.partyId) throw new AuthorisationError('membership.write', ctx);
  const m = await prisma.membership.findFirst({
    where: { orgId, personId: ctx.partyId, exitedAt: null, status: 'ACTIVE', role: { in: OFFICER_ROLES } },
  });
  if (!m) throw new AuthorisationError('membership.write', ctx);
}

/** PENDING when the group charges a join fee — see joinFeeKes on
 *  GroupTreasuryPolicy and createJoinFeePayment in dal/treasury.ts,
 *  which activates the membership once that fee is confirmed. ACTIVE
 *  immediately for a free group, same as before joinFeeKes existed. */
async function resolveJoinStatus(orgId: string): Promise<'PENDING' | 'ACTIVE'> {
  const policy = await prisma.groupTreasuryPolicy.findUnique({
    where: { orgId }, select: { joinFeeKes: true },
  });
  return policy?.joinFeeKes && Number(policy.joinFeeKes) > 0 ? 'PENDING' : 'ACTIVE';
}

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

/**
 * Self-serve group founding — the /me/group counterpart to createGroup
 * above (which is staff-only, off a paper roster) and the same shape as
 * createJamiiPage (packages/db/src/dal/jamii-page.ts) and createTicketOrg
 * (dal/ticketing.ts): a signed-in person founds their own org with no
 * staff capability, gated only by ctx.partyId plus group.create:own.
 *
 * The founder is seeded in as CHAIRPERSON, not a bare MEMBER — that's
 * what makes multisig "auto enabled": getEffectiveSignerIds in
 * dal/treasury.ts already falls back to the group's officers
 * (CHAIRPERSON/TREASURER/SECRETARY) whenever no GroupSigner rows have
 * been configured, so the founder can request and sign withdrawals from
 * the moment the group exists — no separate signer setup step. A real
 * chama with several officers can add more signers later via
 * addGroupSigner; a one-person group is not left signer-less waiting on
 * a step nobody has a reason to take on day one.
 *
 * A person may found or belong to more than one group — Membership's
 * uniqueness is (personId, orgId), so nothing at the schema level ever
 * stopped this; only this function's own check used to. /me/group and
 * dal/subject.ts's getMyRecord already return every active membership,
 * not just one, so the UI already had to support a list.
 */
export async function createOwnGroup(
  ctx: Ctx,
  input: {
    orgKind: OrgKind; orgKindOther?: string; officialName: string; knownAs?: string; county: string;
    ward?: string; registrationNo?: string; memberCount?: number;
  },
) {
  requireCapability(ctx, 'group.create', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in to start a group');

  const officialName = input.officialName.trim();
  if (!officialName) throw new Error('A group name is required');
  if (!input.county) throw new Error('A county is required');
  const kindOther = input.orgKind === 'OTHER' ? input.orgKindOther?.trim() : undefined;
  if (input.orgKind === 'OTHER' && !kindOther) throw new Error('Say what kind of group this is');

  const founder = await prisma.person.findUnique({ where: { partyId: ctx.partyId } });
  if (!founder) throw new Error('Only a registered person may start a group');

  const party = await prisma.$transaction(async (tx) => {
    const p = await tx.party.create({
      data: {
        kind: 'ORGANISATION',
        county: input.county,
        ward: input.ward || null,
        organisation: {
          create: {
            kind: input.orgKind,
            kindOther: kindOther || null,
            officialName,
            knownAs: input.knownAs?.trim() || null,
            registrationNo: input.registrationNo?.trim() || null,
            memberCount: input.memberCount ?? null,
          },
        },
        accounts: { create: [{ kind: 'GROUP_SAVINGS', currency: 'KES' }] },
      },
      include: { organisation: true },
    });

    const m = await tx.membership.create({
      data: { personId: ctx.partyId!, orgId: p.id, role: 'CHAIRPERSON' },
    });

    await recordAudit(ctx, {
      action: 'group.created', targetType: 'organisation', targetId: p.id,
      payload: { kind: input.orgKind, officialName, county: input.county, self_serve: true },
    }, tx as never);
    await recordAudit(ctx, {
      action: 'membership.added', targetType: 'membership', targetId: m.id,
      payload: { orgPartyId: p.id, personPartyId: ctx.partyId, role: 'CHAIRPERSON' },
    }, tx as never);

    return p;
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

/**
 * Self-serve member list for /me/group's manage-members panel — visible
 * to any active member of the group (not just its officers; seeing your
 * fellow members is not privileged, only changing them is). Includes
 * PENDING members so officers can see who still owes a join fee.
 */
export async function listMyGroupMembers(ctx: Ctx, orgId: string) {
  requireCapability(ctx, 'membership.write', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new AuthorisationError('membership.write', ctx);
  const isMember = await prisma.membership.findFirst({
    where: { orgId, personId: ctx.partyId, exitedAt: null },
  });
  if (!isMember) throw new AuthorisationError('membership.write', ctx);

  return prisma.membership.findMany({
    where: { orgId, exitedAt: null },
    include: { person: { include: { person: true } } },
    orderBy: { joinedAt: 'asc' },
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
  await requireGroupOfficer(ctx, orgPartyId);
  const resolvedCustomRole = resolveCustomRole(role, customRole);

  const existing = await prisma.membership.findUnique({
    where: { personId_orgId: { personId: personPartyId, orgId: orgPartyId } },
  });

  const m = existing
    ? await prisma.membership.update({
        where: { id: existing.id }, data: { exitedAt: null, role, customRole: resolvedCustomRole },
      })
    : await prisma.membership.create({
        data: {
          personId: personPartyId, orgId: orgPartyId, role, customRole: resolvedCustomRole,
          status: await resolveJoinStatus(orgPartyId),
        },
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
  // Staff-only, deliberately — this creates a full member immediately
  // with no accept step, which is right for a paper roster staff can
  // vouch for but too much trust to hand a group's own officers. Their
  // self-serve equivalent is inviteMember below, which always goes
  // through pending-until-accepted (and pending-until-paid, if this
  // group charges a join fee).
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
  const status = await resolveJoinStatus(orgPartyId);

  return prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        kind: 'PERSON', county: org.party.county,
        person: { create: { officialName, msisdn } },
      },
    });
    const m = await tx.membership.create({
      data: { personId: party.id, orgId: orgPartyId, role, customRole: resolvedCustomRole, status },
    });
    await recordAudit(ctx, {
      action: 'membership.added_new_person', targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personId: party.id, role, customRole: resolvedCustomRole, hasPhone: Boolean(msisdn) },
    }, tx as never);
    return m;
  });
}

export interface InviteMemberResult {
  membership: Awaited<ReturnType<typeof prisma.membership.create>>;
  /** What to actually notify the invitee with — @esoko/db can't import
   *  @esoko/auth's sendSms/sendEmail (it's the other way around:
   *  auth depends on db), so the Server Action calling inviteMember is
   *  the one that sends this. See actionInviteMember in
   *  apps/app/src/app/me/group/actions.ts. */
  notify: { channel: 'sms'; to: string } | { channel: 'email'; to: string };
  orgName: string;
}

/**
 * Self-serve invite — a group's own officer inviting someone by phone
 * or email, the /me/group counterpart to addMember/addNewMember above.
 * Unlike addNewMember it never errors when the contact already belongs
 * to someone on Esoko — it just adds that existing person, the way an
 * officer inviting a friend expects. A brand-new contact gets a new
 * Person the same way addNewMember does — with only whichever of
 * msisdn/email was actually given, same "pending until someone fills
 * the rest in" shape Person.msisdn already documents. An email-only
 * person can't sign in yet (the whole product is msisdn+OTP — see
 * packages/auth/src/otp.ts) until a phone number is added to their
 * record; the invite email says as much.
 *
 * The membership itself starts PENDING whenever the group charges a
 * join fee (see resolveJoinStatus) regardless of which branch runs —
 * an invite is not a payment, so it never skips the gate the way a
 * staff-added paper-roster member (addNewMember, still ACTIVE-by-
 * default there too via the same resolveJoinStatus call) does not
 * skip it either. Same one-invite-per-contact idempotency as addMember:
 * re-inviting someone who left reinstates them.
 */
export async function inviteMember(
  ctx: Ctx, orgPartyId: string,
  input: { msisdn?: string; email?: string; officialName?: string },
  role: MemberRole = 'MEMBER', customRole?: string,
): Promise<InviteMemberResult> {
  await requireGroupOfficer(ctx, orgPartyId);
  const resolvedCustomRole = resolveCustomRole(role, customRole);

  let msisdn: string | null = null;
  if (input.msisdn?.trim()) {
    msisdn = normaliseMsisdn(input.msisdn);
    if (!msisdn) {
      throw new Error('That does not look like a Kenyan mobile number — try the format 07XX XXX XXX');
    }
  }
  const email = input.email?.trim().toLowerCase() || null;
  if (!msisdn && !email) throw new Error('Enter a phone number or an email address to invite them');

  const org = await prisma.organisation.findUniqueOrThrow({
    where: { partyId: orgPartyId }, select: { officialName: true, knownAs: true, party: { select: { county: true } } },
  });
  const orgName = org.knownAs || org.officialName;
  const notify: InviteMemberResult['notify'] = msisdn ? { channel: 'sms', to: msisdn } : { channel: 'email', to: email! };

  const status = await resolveJoinStatus(orgPartyId);
  const existingPerson = await prisma.person.findFirst({
    where: msisdn ? { msisdn } : { email: email! },
  });

  if (existingPerson) {
    const existing = await prisma.membership.findUnique({
      where: { personId_orgId: { personId: existingPerson.partyId, orgId: orgPartyId } },
    });
    const m = existing
      ? await prisma.membership.update({
          where: { id: existing.id }, data: { exitedAt: null, role, customRole: resolvedCustomRole, status },
        })
      : await prisma.membership.create({
          data: { personId: existingPerson.partyId, orgId: orgPartyId, role, customRole: resolvedCustomRole, status },
        });
    await recordAudit(ctx, {
      action: existing ? 'membership.reinstated' : 'membership.invited',
      targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personId: existingPerson.partyId, role, status },
    });
    return { membership: m, notify, orgName };
  }

  const officialName = input.officialName?.trim();
  if (!officialName) throw new Error('Enter their name — that contact is not on Esoko yet');

  const membership = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: { kind: 'PERSON', county: org.party.county, person: { create: { officialName, msisdn, email } } },
    });
    const m = await tx.membership.create({
      data: { personId: party.id, orgId: orgPartyId, role, customRole: resolvedCustomRole, status },
    });
    await recordAudit(ctx, {
      action: 'membership.invited_new_person', targetType: 'membership', targetId: m.id,
      payload: { orgPartyId, personId: party.id, role, status },
    }, tx as never);
    return m;
  });
  return { membership, notify, orgName };
}

export async function setMemberRole(
  ctx: Ctx, membershipId: string, role: MemberRole, customRole?: string,
) {
  const existing = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!existing) throw new Error('Member not found');
  await requireGroupOfficer(ctx, existing.orgId);
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
  const existing = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!existing) throw new Error('Member not found');
  await requireGroupOfficer(ctx, existing.orgId);
  const m = await prisma.membership.update({
    where: { id: membershipId }, data: { exitedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'membership.removed', targetType: 'membership', targetId: membershipId,
    payload: { reason },
  });
  return m;
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
