
import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type {
  JoinPath,
  RegistrationStatus,
  PartyKind,
  OrgKind,
  MemberRole,
} from '@prisma/client';

/* ── inputs ─────────────────────────────────────────────────── */

export interface StartRegistrationInput {
  joiningAs: 'me' | 'group' | 'biz';
  language?: string;
  path?: JoinPath;
  agentId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface UpdateRegistrationInput {
  officialName?: string;
  knownAs?: string;
  msisdn?: string;
  email?: string;
  county?: string;
  ward?: string;
  workRaw?: string;
  segment?: string;
  orgName?: string;
  orgKnownAs?: string;
  orgRole?: string;
  memberCount?: number;
  hasRegisteredBusiness?: string;
  registrationNo?: string;
  belongsToGroup?: string;
  groupName?: string;
  groupPartyId?: string;
  feeCoverage?: string;
  hasKraPin?: string;
  wantsPriceSms?: boolean;
  wantsReceiptSms?: boolean;
  wantsExpirySms?: boolean;
  ussdSetupChoice?: 'now' | 'later';
}

/** Maps the free-typed "role in the group" onto the fixed Membership
 *  enum. A custom role (e.g. "Auditor") has nowhere to live on the strict
 *  enum, so it defaults to MEMBER — the typed text itself stays visible
 *  on Registration.orgRole for admin/history. */
function toMemberRole(orgRole: string | null | undefined): MemberRole {
  const known: Record<string, MemberRole> = {
    chairperson: 'CHAIRPERSON', treasurer: 'TREASURER',
    secretary: 'SECRETARY', member: 'MEMBER',
  };
  return known[orgRole?.trim().toLowerCase() ?? ''] ?? 'MEMBER';
}

/* ── writes ─────────────────────────────────────────────────── */

export async function startRegistration(ctx: Ctx, input: StartRegistrationInput) {
  requireCapability(ctx, 'registration.create');

  const reg = await prisma.registration.create({
    data: {
      joiningAs: input.joiningAs,
      language: input.language ?? 'en',
      path: input.path ?? 'SELF_WEB',
      agentId: input.agentId,
      ip: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
      status: 'STARTED',
    },
  });

  await recordAudit(ctx, {
    action: 'registration.started',
    targetType: 'registration',
    targetId: reg.id,
    payload: { joiningAs: input.joiningAs, path: reg.path },
  });

  return reg;
}

export async function updateRegistration(
  ctx: Ctx,
  id: string,
  input: UpdateRegistrationInput,
) {
  requireCapability(ctx, 'registration.write', { registrationId: id });

  const existing = await prisma.registration.findUnique({ where: { id } });
  if (!existing) throw new Error('Registration not found');
  if (existing.status === 'COMPLETE') {
    throw new Error('Registration already complete and cannot be edited');
  }

  const reg = await prisma.registration.update({ where: { id }, data: input });

  // Audit the SHAPE of what changed, never the values. A phone number in
  // an audit payload is a data-protection problem waiting to be found.
  await recordAudit(ctx, {
    action: 'registration.updated',
    targetType: 'registration',
    targetId: id,
    payload: { fields: Object.keys(input) },
  });

  return reg;
}

export async function markOtpSent(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.write', { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: 'AWAITING_OTP' },
  });
  await recordAudit(ctx, {
    action: 'registration.otp_sent',
    targetType: 'registration',
    targetId: id,
  });
  return reg;
}

export async function markMsisdnVerified(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.write', { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: 'VERIFIED', msisdnVerifiedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'registration.msisdn_verified',
    targetType: 'registration',
    targetId: id,
  });
  return reg;
}

/**
 * Converts a completed registration into a real Party.
 *
 * Everything happens in one transaction, audit included. A registration
 * that is not COMPLETE never becomes a Party — which is precisely how a
 * pre-provisioned or abandoned record avoids being counted as a user.
 */
export async function completeRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.write', { registrationId: id });

  return prisma.$transaction(async (tx) => {
    const reg = await tx.registration.findUnique({ where: { id } });
    if (!reg) throw new Error('Registration not found');
    if (reg.status === 'COMPLETE') return { registration: reg, partyId: reg.partyId! };
    if (!reg.msisdn) throw new Error('Cannot complete without a phone number');
    if (!reg.county) throw new Error('Cannot complete without a county');
    if (!reg.officialName) throw new Error('Cannot complete without an official name');

    const existingPerson = await tx.person.findUnique({ where: { msisdn: reg.msisdn } });
    if (existingPerson) {
      throw Object.assign(new Error('This number is already registered'), {
        code: 'MSISDN_TAKEN',
      });
    }

    // 1 · the person
    const personParty = await tx.party.create({
      data: {
        kind: 'PERSON' as PartyKind,
        county: reg.county,
        ward: reg.ward,
        person: {
          create: {
            officialName: reg.officialName,
            knownAs: reg.knownAs,
            msisdn: reg.msisdn,
            email: reg.email,
            msisdnVerifiedAt: reg.msisdnVerifiedAt,
          },
        },
        accounts: { create: [{ kind: 'WALLET', currency: 'KES' }] },
      },
      include: { person: true },
    });

    // 2 · the organisation, if one is being registered
    let orgPartyId: string | null = null;
    if (reg.joiningAs === 'group' && reg.orgName) {
      const orgParty = await tx.party.create({
        data: {
          kind: 'ORGANISATION' as PartyKind,
          county: reg.county,
          ward: reg.ward,
          organisation: {
            create: {
              kind: (reg.hasRegisteredBusiness === 'yes' ? 'COOPERATIVE' : 'CHAMA') as OrgKind,
              officialName: reg.orgName,
              knownAs: reg.orgKnownAs,
              registrationNo: reg.registrationNo,
              memberCount: reg.memberCount,
            },
          },
          accounts: { create: [{ kind: 'GROUP_SAVINGS', currency: 'KES' }] },
        },
      });
      orgPartyId = orgParty.id;

      await tx.membership.create({
        data: {
          personId: personParty.id,
          orgId: orgParty.id,
          role: toMemberRole(reg.orgRole),
        },
      });
    }

    // 2b · linking to an existing group, for someone joining on their own
    if (reg.joiningAs !== 'group' && reg.belongsToGroup === 'yes' && reg.groupPartyId) {
      await tx.membership.create({
        data: { personId: personParty.id, orgId: reg.groupPartyId, role: 'MEMBER' },
      });
    }

    // 3 · the enterprise
    if (reg.workRaw) {
      await tx.enterprise.create({
        data: {
          partyId: orgPartyId ?? personParty.id,
          workRaw: reg.workRaw,
          segment: reg.segment,
          isRegistered: reg.hasRegisteredBusiness === 'yes',
          hasKraPin: reg.hasKraPin === 'yes',
        },
      });
    }

    // 4 · attestations for what we actually verified ourselves
    if (reg.msisdnVerifiedAt) {
      await tx.attestation.create({
        data: {
          subjectId: personParty.id,
          claimType: 'MSISDN_VERIFIED',
          claimValue: { msisdn: reg.msisdn },
          method: 'API',
          issuedAt: reg.msisdnVerifiedAt,
        },
      });
    }

    // 5 · close the funnel record
    const done = await tx.registration.update({
      where: { id },
      data: { status: 'COMPLETE' as RegistrationStatus, completedAt: new Date(), partyId: personParty.id },
    });

    await recordAudit(
      ctx,
      {
        action: 'registration.completed',
        targetType: 'party',
        targetId: personParty.id,
        payload: {
          registrationId: id,
          joiningAs: reg.joiningAs,
          county: reg.county,
          orgCreated: Boolean(orgPartyId),
        },
      },
      tx as never,
    );

    return { registration: done, partyId: personParty.id, orgPartyId };
  });
}

/* ── reads ──────────────────────────────────────────────────── */

export async function getRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.read', { registrationId: id });
  return prisma.registration.findUnique({ where: { id } });
}

export interface ListRegistrationsFilter {
  status?: RegistrationStatus;
  county?: string;
  from?: Date;
  to?: Date;
  search?: string;
  /** 'organisations' → joiningAs === 'group'; 'individuals' → anything else. */
  type?: 'individuals' | 'organisations';
  take?: number;
  skip?: number;
}

export async function listRegistrations(ctx: Ctx, f: ListRegistrationsFilter = {}) {
  requireCapability(ctx, 'registration.read', { county: f.county });

  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.county ? { county: f.county } : {}),
    ...(f.type === 'organisations' ? { joiningAs: 'group' } : {}),
    ...(f.type === 'individuals' ? { joiningAs: { not: 'group' } } : {}),
    ...(f.from || f.to
      ? { startedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.search
      ? {
          OR: [
            { officialName: { contains: f.search, mode: 'insensitive' as const } },
            { knownAs: { contains: f.search, mode: 'insensitive' as const } },
            { orgName: { contains: f.search, mode: 'insensitive' as const } },
            { workRaw: { contains: f.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: f.take ?? 25,
      skip: f.skip ?? 0,
    }),
    prisma.registration.count({ where }),
  ]);

  return { rows, total };
}

export async function findRegistrationByMsisdn(ctx: Ctx, msisdn: string) {
  requireCapability(ctx, 'registration.read');
  return prisma.registration.findFirst({
    where: { msisdn, status: { not: 'COMPLETE' } },
    orderBy: { startedAt: 'desc' },
  });
}

/* ── admin CRUD ─────────────────────────────────────────────── */

/**
 * Void rather than delete.
 *
 * A hard delete would break the audit chain's reference and destroy the
 * only record that someone's data was ever held — which is the opposite
 * of what a DPA erasure request requires. Voiding removes it from every
 * report and count while keeping the trail.
 */
export async function voidRegistration(ctx: Ctx, id: string, reason: string) {
  requireCapability(ctx, 'registration.void', { registrationId: id });
  if (!reason?.trim()) throw new Error('A reason is required to void a registration');

  const reg = await prisma.registration.update({
    where: { id },
    data: {
      status: 'ABANDONED', voidedAt: new Date(),
      voidedById: ctx.actorId ?? undefined, voidReason: reason.trim(),
    },
  });
  await recordAudit(ctx, {
    action: 'registration.voided', targetType: 'registration', targetId: id, payload: { reason },
  });
  return reg;
}

export async function restoreRegistration(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.void', { registrationId: id });
  const reg = await prisma.registration.update({
    where: { id },
    data: { status: 'STARTED', voidedAt: null, voidedById: null, voidReason: null },
  });
  await recordAudit(ctx, {
    action: 'registration.restored', targetType: 'registration', targetId: id,
  });
  return reg;
}

/** Staff-initiated registration — walk-ins, phone calls, agent capture. */
export async function createRegistrationForPerson(
  ctx: Ctx,
  input: UpdateRegistrationInput & { joiningAs: 'me' | 'group' | 'biz' },
) {
  requireCapability(ctx, 'registration.create');
  const reg = await prisma.registration.create({
    data: { ...input, path: 'AGENT_ASSISTED', agentId: ctx.actorId ?? undefined, status: 'STARTED' },
  });
  await recordAudit(ctx, {
    action: 'registration.created_by_staff', targetType: 'registration', targetId: reg.id,
    payload: { joiningAs: input.joiningAs },
  });
  return reg;
}

/** Full detail for the admin drawer — registration, payment, documents. */
export async function getRegistrationDetail(ctx: Ctx, id: string) {
  requireCapability(ctx, 'registration.read', { registrationId: id });
  const reg = await prisma.registration.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          approvals: {
            include: { approver: { select: { id: true, name: true, email: true } } },
            orderBy: { signedAt: 'asc' },
          },
        },
      },
      documents: { where: { deletedAt: null }, orderBy: { uploadedAt: 'desc' } },
      party: { include: { person: true, enterprises: true, attestations: true } },
    },
  });
  if (!reg) return null;
  return {
    ...reg,
    payment: reg.payment
      ? { ...reg.payment, amountKes: reg.payment.amountKes ? Number(reg.payment.amountKes) : null }
      : null,
  };
}

/** Probable duplicates — the agent-fraud control from the journey maps. */
export async function findProbableDuplicates(ctx: Ctx, take = 25) {
  requireCapability(ctx, 'duplicate.review');
  const rows = await prisma.$queryRaw<
    { msisdn: string; n: bigint; ids: string[] }[]
  >`
    SELECT "msisdn", COUNT(*)::bigint AS n, array_agg(id::text) AS ids
    FROM registration
    WHERE "msisdn" IS NOT NULL AND "voidedAt" IS NULL
    GROUP BY "msisdn" HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT ${take}`;
  return rows.map((r) => ({ msisdn: r.msisdn, count: Number(r.n), ids: r.ids }));
}
