import { createHmac, timingSafeEqual } from 'node:crypto';
import { verify as verifyArgon2 } from '@node-rs/argon2';
import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type {
  ApprovalDecision, AttendanceMethod, GroupContribution, MemberRole, PaymentMethod, Prisma,
} from '@prisma/client';

/**
 * Group treasury — contributions, meetings/attendance, and the
 * scheduled multisig withdrawal flow.
 *
 * See docs/proposals/esoqo-group-treasury-and-payment-id.md for why
 * every shape here is the way it is. The short version:
 *
 *   · A contribution declaration is not money, same rule as
 *     RegistrationPayment — only an officer's confirmation or a live
 *     STK callback moves it to CONFIRMED and posts a JournalEntry.
 *   · A withdrawal signature mirrors PaymentApproval's HMAC + "one
 *     REJECT halts" shape, but signs against a Party (group member),
 *     never queued offline — pinVerifiedAt is always fresh.
 *   · The standby window is walked forward through the policy's
 *     active hours, not a raw wall-clock add — a request raised
 *     Saturday night does not expire while every signer is asleep.
 *
 * This module writes Postings directly, the same bridge pattern
 * dal/_commerce-ledger.ts and dal/donation.ts already use ahead of
 * services/ledger (Rust, Phase 2, not yet built — see its README).
 */

const SECRET = process.env.SESSION_SECRET ?? 'dev-signing-secret';

const OFFICER_ROLES: MemberRole[] = ['CHAIRPERSON', 'TREASURER', 'SECRETARY'];

const POLICY_DEFAULTS = {
  requiredSigners: 2,
  withdrawalLeadMinutes: 70,
  activeHoursStart: 7,
  activeHoursEnd: 20,
  requireQuorateMeeting: false,
  contributionsEnabled: true,
  contributionAmountKes: null as number | null,
  contributionCycle: null as string | null,
  joinFeeKes: null as number | null,
};

export class TreasuryError extends Error {
  constructor(msg: string, public readonly code:
    'NOT_FOUND' | 'NOT_A_MEMBER' | 'NOT_AN_OFFICER' | 'NOT_A_SIGNER' | 'ALREADY_SIGNED'
    | 'ALREADY_SETTLED' | 'NOT_DECLARED' | 'WRONG_PIN' | 'NO_PIN_SET' | 'WINDOW_NOT_ELAPSED'
    | 'CONTRIBUTIONS_DISABLED' | 'NOT_PENDING' | 'NO_JOIN_FEE') {
    super(msg);
    this.name = 'TreasuryError';
  }
}

/* ── shared lookups ──────────────────────────────────────── */

async function findOrCreateGroupSavingsAccount(tx: Prisma.TransactionClient, orgId: string) {
  const existing = await tx.account.findFirst({ where: { partyId: orgId, kind: 'GROUP_SAVINGS', currency: 'KES' } });
  if (existing) return existing;
  return tx.account.create({ data: { partyId: orgId, kind: 'GROUP_SAVINGS', currency: 'KES' } });
}

async function findOrCreateSettlementAccount(tx: Prisma.TransactionClient) {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  if (existing) return existing;
  return tx.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
}

/** PENDING or ACTIVE, just not exited — enough to read the policy (so a
 *  PENDING member can see what they owe) or pay a join fee, but not
 *  enough to contribute, sign, or do anything else treasury-side. */
async function assertMember(orgId: string, personId: string) {
  const m = await prisma.membership.findFirst({ where: { orgId, personId, exitedAt: null } });
  if (!m) throw new TreasuryError('You are not a member of this group', 'NOT_A_MEMBER');
  return m;
}

async function assertActiveMember(orgId: string, personId: string) {
  const m = await prisma.membership.findFirst({ where: { orgId, personId, exitedAt: null, status: 'ACTIVE' } });
  if (!m) {
    throw new TreasuryError(
      (await prisma.membership.findFirst({ where: { orgId, personId, exitedAt: null, status: 'PENDING' } }))
        ? 'Pay the join fee to activate your membership first'
        : 'You are not an active member of this group',
      'NOT_A_MEMBER',
    );
  }
  return m;
}

async function isOfficer(orgId: string, personId: string): Promise<boolean> {
  const m = await prisma.membership.findFirst({
    where: { orgId, personId, exitedAt: null, role: { in: OFFICER_ROLES } },
  });
  return Boolean(m);
}

/**
 * Who may sign a withdrawal for this group. Configurable per group via
 * GroupSigner; a group that has never configured one falls back to its
 * three officer roles, so a brand-new group is never signer-less.
 */
async function getEffectiveSignerIds(orgId: string): Promise<string[]> {
  const configured = await prisma.groupSigner.findMany({
    where: { orgId, removedAt: null }, select: { personId: true },
  });
  if (configured.length > 0) return configured.map((s) => s.personId);

  const officers = await prisma.membership.findMany({
    where: { orgId, exitedAt: null, role: { in: OFFICER_ROLES } }, select: { personId: true },
  });
  return officers.map((m) => m.personId);
}

/** Existing policy, or the hardcoded defaults for a group that has never configured one. */
export async function getTreasuryPolicy(ctx: Ctx, orgId: string) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertMember(orgId, ctx.partyId!);

  const policy = await prisma.groupTreasuryPolicy.findUnique({ where: { orgId } });
  const signers = await prisma.groupSigner.findMany({
    where: { orgId, removedAt: null },
    include: { person: { include: { person: true } } },
  });
  return {
    orgId,
    requiredSigners: policy?.requiredSigners ?? POLICY_DEFAULTS.requiredSigners,
    withdrawalLeadMinutes: policy?.withdrawalLeadMinutes ?? POLICY_DEFAULTS.withdrawalLeadMinutes,
    activeHoursStart: policy?.activeHoursStart ?? POLICY_DEFAULTS.activeHoursStart,
    activeHoursEnd: policy?.activeHoursEnd ?? POLICY_DEFAULTS.activeHoursEnd,
    requireQuorateMeeting: policy?.requireQuorateMeeting ?? POLICY_DEFAULTS.requireQuorateMeeting,
    contributionsEnabled: policy?.contributionsEnabled ?? POLICY_DEFAULTS.contributionsEnabled,
    contributionAmountKes: policy?.contributionAmountKes ? Number(policy.contributionAmountKes) : null,
    contributionCycle: policy?.contributionCycle ?? null,
    joinFeeKes: policy?.joinFeeKes ? Number(policy.joinFeeKes) : null,
    isConfigured: Boolean(policy),
    signers,
  };
}

export interface SetTreasuryPolicyInput {
  requiredSigners?: number;
  withdrawalLeadMinutes?: number;
  activeHoursStart?: number;
  activeHoursEnd?: number;
  requireQuorateMeeting?: boolean;
  contributionsEnabled?: boolean;
  contributionAmountKes?: number | null;
  contributionCycle?: string | null;
  joinFeeKes?: number | null;
}

/** Only a current officer may change how their own group's treasury runs. */
export async function setTreasuryPolicy(ctx: Ctx, orgId: string, input: SetTreasuryPolicyInput) {
  requireCapability(ctx, 'treasury.policy.write', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  if (!(await isOfficer(orgId, ctx.partyId!))) {
    throw new TreasuryError('Only your group’s officers can change treasury settings', 'NOT_AN_OFFICER');
  }
  if (input.requiredSigners !== undefined && input.requiredSigners < 1) {
    throw new Error('At least one signer is required');
  }
  if (input.activeHoursStart !== undefined && (input.activeHoursStart < 0 || input.activeHoursStart > 23)) {
    throw new Error('Active hours start must be between 0 and 23');
  }
  if (input.activeHoursEnd !== undefined && (input.activeHoursEnd < 1 || input.activeHoursEnd > 24)) {
    throw new Error('Active hours end must be between 1 and 24');
  }
  if (input.joinFeeKes != null && input.joinFeeKes < 0) {
    throw new Error('A join fee cannot be negative');
  }

  const policy = await prisma.groupTreasuryPolicy.upsert({
    where: { orgId },
    create: { orgId, ...POLICY_DEFAULTS, ...input, updatedById: ctx.partyId },
    update: { ...input, updatedById: ctx.partyId },
  });

  await recordAudit(ctx, {
    action: 'treasury.policy.set', targetType: 'group_treasury_policy', targetId: orgId,
    payload: { ...input },
  });
  return policy;
}

/** Adds a member to the group's signer list. Idempotent — reinstates a removed signer. */
export async function addGroupSigner(ctx: Ctx, orgId: string, personId: string) {
  requireCapability(ctx, 'treasury.policy.write', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  if (!(await isOfficer(orgId, ctx.partyId!))) {
    throw new TreasuryError('Only your group’s officers can change who signs', 'NOT_AN_OFFICER');
  }
  await assertActiveMember(orgId, personId);

  const existing = await prisma.groupSigner.findUnique({ where: { orgId_personId: { orgId, personId } } });
  const signer = existing
    ? await prisma.groupSigner.update({ where: { id: existing.id }, data: { removedAt: null } })
    : await prisma.groupSigner.create({ data: { orgId, personId, addedById: ctx.partyId! } });

  await recordAudit(ctx, {
    action: 'treasury.signer.added', targetType: 'group_signer', targetId: signer.id,
    payload: { orgId, personId },
  });
  return signer;
}

export async function removeGroupSigner(ctx: Ctx, orgId: string, personId: string) {
  requireCapability(ctx, 'treasury.policy.write', { partyId: ctx.partyId });
  if (!(await isOfficer(orgId, ctx.partyId!))) {
    throw new TreasuryError('Only your group’s officers can change who signs', 'NOT_AN_OFFICER');
  }
  const existing = await prisma.groupSigner.findUnique({ where: { orgId_personId: { orgId, personId } } });
  if (!existing || existing.removedAt) return existing;

  const signer = await prisma.groupSigner.update({ where: { id: existing.id }, data: { removedAt: new Date() } });
  await recordAudit(ctx, {
    action: 'treasury.signer.removed', targetType: 'group_signer', targetId: signer.id,
    payload: { orgId, personId },
  });
  return signer;
}

/* ── meetings & attendance ───────────────────────────────── */

export interface ScheduleMeetingInput {
  orgId: string;
  scheduledAt: Date;
  location?: string;
  agenda?: string;
  quorumPct?: number;
}

export async function scheduleMeeting(ctx: Ctx, input: ScheduleMeetingInput) {
  requireCapability(ctx, 'treasury.meeting.write', { partyId: ctx.partyId });
  await assertActiveMember(input.orgId, ctx.partyId!);
  if (!(await isOfficer(input.orgId, ctx.partyId!))) {
    throw new TreasuryError('Only your group’s officers can call a meeting', 'NOT_AN_OFFICER');
  }

  const meeting = await prisma.meeting.create({
    data: {
      orgId: input.orgId, scheduledAt: input.scheduledAt, location: input.location,
      agenda: input.agenda, quorumPct: input.quorumPct ?? 50, calledById: ctx.partyId!,
    },
  });
  await recordAudit(ctx, {
    action: 'treasury.meeting.scheduled', targetType: 'meeting', targetId: meeting.id,
    payload: { orgId: input.orgId, scheduledAt: input.scheduledAt.toISOString() },
  });
  return meeting;
}

export async function listMeetings(ctx: Ctx, orgId: string, take = 20) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  return prisma.meeting.findMany({
    where: { orgId },
    include: { attendance: true, calledBy: { include: { person: true } } },
    orderBy: { scheduledAt: 'desc' },
    take,
  });
}

/**
 * Present/absent for one's own attendance, or — with AGENT_MARKED — an
 * officer marking on behalf of a member with no phone in hand. Never
 * anonymous: markedById always names who actually did it.
 */
export async function markAttendance(
  ctx: Ctx, meetingId: string,
  input: { personId?: string; present: boolean; method: AttendanceMethod },
) {
  requireCapability(ctx, 'attendance.write', { partyId: ctx.partyId });
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new TreasuryError('Meeting not found', 'NOT_FOUND');

  const targetPersonId = input.personId ?? ctx.partyId!;
  if (targetPersonId !== ctx.partyId) {
    if (input.method !== 'AGENT_MARKED') {
      throw new Error('Marking attendance for someone else requires the AGENT_MARKED method');
    }
    if (!(await isOfficer(meeting.orgId, ctx.partyId!))) {
      throw new TreasuryError('Only an officer may mark attendance for another member', 'NOT_AN_OFFICER');
    }
  }
  await assertActiveMember(meeting.orgId, targetPersonId);

  const record = await prisma.attendanceRecord.upsert({
    where: { meetingId_personId: { meetingId, personId: targetPersonId } },
    create: {
      meetingId, personId: targetPersonId, present: input.present, method: input.method,
      markedById: targetPersonId === ctx.partyId ? null : ctx.partyId,
    },
    update: {
      present: input.present, method: input.method,
      markedById: targetPersonId === ctx.partyId ? null : ctx.partyId, markedAt: new Date(),
    },
  });

  await recordAudit(ctx, {
    action: 'treasury.attendance.marked', targetType: 'attendance_record', targetId: record.id,
    payload: { meetingId, personId: targetPersonId, present: input.present, method: input.method },
  });
  return record;
}

/* ── contributions ────────────────────────────────────────── */

export interface DeclareContributionInput {
  orgId: string;
  amountKes: number;
  method?: PaymentMethod;
  reference?: string;
  note?: string;
}

/** A declaration is not money — a member's own claim, awaiting confirmation. */
export async function declareContribution(ctx: Ctx, input: DeclareContributionInput) {
  requireCapability(ctx, 'treasury.contribute', { partyId: ctx.partyId });
  await assertActiveMember(input.orgId, ctx.partyId!);
  if (!(input.amountKes > 0)) throw new Error('Enter an amount above zero');

  const policy = await prisma.groupTreasuryPolicy.findUnique({
    where: { orgId: input.orgId }, select: { contributionsEnabled: true },
  });
  if (policy && !policy.contributionsEnabled) {
    throw new TreasuryError('This group is not currently taking contributions', 'CONTRIBUTIONS_DISABLED');
  }

  const account = await findOrCreateGroupSavingsAccount(prisma, input.orgId);
  const contribution = await prisma.groupContribution.create({
    data: {
      orgId: input.orgId, accountId: account.id, contributorId: ctx.partyId!,
      amountKes: input.amountKes, method: input.method,
      reference: input.reference?.trim().toUpperCase(), declaredNote: input.note,
    },
  });

  await recordAudit(ctx, {
    action: 'treasury.contribution.declared', targetType: 'group_contribution', targetId: contribution.id,
    payload: { orgId: input.orgId, method: input.method, hasReference: Boolean(input.reference) },
  });
  return contribution;
}

/**
 * A PENDING member declares payment of the join fee set on the group's
 * policy — same "declare, an officer confirms" shape as declareContribution,
 * just for the one-off fee rather than a recurring contribution, and
 * tagged with membershipId so confirming it (postContribution above)
 * also flips the membership to ACTIVE. Errors if the group charges no
 * fee, or the caller's membership is already ACTIVE — there is nothing
 * to pay.
 */
export async function createJoinFeePayment(
  ctx: Ctx, orgId: string, input: { method?: PaymentMethod; reference?: string },
) {
  requireCapability(ctx, 'treasury.contribute', { partyId: ctx.partyId });
  const membership = await assertMember(orgId, ctx.partyId!);
  if (membership.status !== 'PENDING') {
    throw new TreasuryError('Your membership is already active — nothing to pay', 'NOT_PENDING');
  }

  const policy = await prisma.groupTreasuryPolicy.findUnique({ where: { orgId } });
  const joinFeeKes = policy?.joinFeeKes ? Number(policy.joinFeeKes) : 0;
  if (!(joinFeeKes > 0)) throw new TreasuryError('This group does not charge a join fee', 'NO_JOIN_FEE');

  const account = await findOrCreateGroupSavingsAccount(prisma, orgId);
  const contribution = await prisma.groupContribution.create({
    data: {
      orgId, accountId: account.id, contributorId: ctx.partyId!, membershipId: membership.id,
      amountKes: joinFeeKes, method: input.method,
      reference: input.reference?.trim().toUpperCase(), declaredNote: 'Join fee',
    },
  });

  await recordAudit(ctx, {
    action: 'treasury.joinfee.declared', targetType: 'group_contribution', targetId: contribution.id,
    payload: { orgId, membershipId: membership.id, amountKes: joinFeeKes },
  });
  return contribution;
}

async function postContribution(
  tx: Prisma.TransactionClient,
  contribution: {
    id: string; orgId: string; accountId: string; amountKes: Prisma.Decimal; membershipId?: string | null;
  },
  extra: { reference?: string } = {},
) {
  const settlement = await findOrCreateSettlementAccount(tx);
  const entry = await tx.journalEntry.create({
    data: {
      reference: `CONTRIBUTION-${contribution.id}`,
      description: 'Group contribution',
      postings: {
        create: [
          { accountId: contribution.accountId, amount: Number(contribution.amountKes) },
          { accountId: settlement.id, amount: -Number(contribution.amountKes) },
        ],
      },
    },
  });
  const updated = await tx.groupContribution.update({
    where: { id: contribution.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), journalEntryId: entry.id, ...extra },
  });

  // Confirming a join-fee payment is what actually admits the member —
  // see createJoinFeePayment below and joinFeeKes on GroupTreasuryPolicy.
  if (contribution.membershipId) {
    await tx.membership.update({
      where: { id: contribution.membershipId }, data: { status: 'ACTIVE' },
    });
  }

  return updated;
}

/**
 * An officer confirms a self-declared contribution — the same
 * "a claim is not money until someone with standing agrees" rule as
 * registration payments, just single-signature rather than dual
 * control, since confirming money-in carries far less risk than
 * approving money-out.
 */
export async function confirmContribution(
  ctx: Ctx, contributionId: string,
): Promise<{ contribution: GroupContribution; alreadyConfirmed: boolean }> {
  requireCapability(ctx, 'treasury.confirm', { partyId: ctx.partyId });

  return prisma.$transaction(async (tx) => {
    const contribution = await tx.groupContribution.findUnique({ where: { id: contributionId } });
    if (!contribution) throw new TreasuryError('Contribution not found', 'NOT_FOUND');
    // Idempotent, and it says so: a caller that texts the whole group on
    // confirmation needs to know the difference between "this just
    // happened" and "a stale button was tapped twice", the same way the
    // Go API's ConfirmContribution returns alreadyConfirmed.
    if (contribution.status === 'CONFIRMED') return { contribution, alreadyConfirmed: true };
    if (contribution.status === 'REJECTED' || contribution.status === 'WAIVED') {
      throw new TreasuryError('This contribution has already been settled', 'ALREADY_SETTLED');
    }
    if (!(await isOfficer(contribution.orgId, ctx.partyId!))) {
      throw new TreasuryError('Only an officer can confirm a contribution', 'NOT_AN_OFFICER');
    }

    const updated = await postContribution(tx, contribution);
    await recordAudit(ctx, {
      action: 'treasury.contribution.confirmed', targetType: 'group_contribution', targetId: contributionId,
      payload: { orgId: contribution.orgId, amountKes: Number(contribution.amountKes) },
    }, tx as never);
    return { contribution: updated, alreadyConfirmed: false };
  });
}

/** A live M-Pesa STK push was just sent for this contribution. */
export async function attachContributionCheckoutRequestId(
  ctx: Ctx, contributionId: string, checkoutRequestId: string,
) {
  requireCapability(ctx, 'treasury.contribute', { partyId: ctx.partyId });
  const contribution = await prisma.groupContribution.update({
    where: { id: contributionId }, data: { checkoutRequestId, method: 'MPESA' },
  });
  await recordAudit(ctx, {
    action: 'treasury.contribution.stk_initiated', targetType: 'group_contribution', targetId: contributionId,
  });
  return contribution;
}

/**
 * Daraja's own confirmation, not a self-reported claim — goes straight
 * to CONFIRMED and posts, skipping the officer-confirm step, the same
 * way confirmRegistrationPaymentByCheckoutId and confirmDonationPayment
 * do. Idempotent: a callback delivered twice is a no-op.
 */
export async function confirmContributionByCheckoutId(checkoutRequestId: string, mpesaReceiptCode: string) {
  const contribution = await prisma.groupContribution.findUnique({ where: { checkoutRequestId } });
  if (!contribution) throw new TreasuryError('No contribution matches this checkout request', 'NOT_FOUND');
  if (contribution.status === 'CONFIRMED') return contribution;

  const updated = await prisma.$transaction((tx) =>
    postContribution(tx, contribution, { reference: mpesaReceiptCode }));

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'treasury.contribution.confirmed', targetType: 'group_contribution', targetId: contribution.id,
    payload: { via: 'mpesa_stk', mpesaReceiptCode },
  });
  return updated;
}

export async function listContributions(ctx: Ctx, orgId: string, take = 30) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  return prisma.groupContribution.findMany({
    where: { orgId },
    include: { contributor: { include: { person: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

async function groupBalanceKes(orgId: string): Promise<number> {
  const account = await prisma.account.findFirst({ where: { partyId: orgId, kind: 'GROUP_SAVINGS' } });
  if (!account) return 0;
  const sum = await prisma.posting.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
}

/** Derived, never stored — the running total is the sum of the group's own postings. */
export async function getGroupBalance(ctx: Ctx, orgId: string): Promise<number> {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  return groupBalanceKes(orgId);
}

/* ── notification support ──────────────────────────────────────────
 *
 * Everything a caller needs to compose and address the two contribution
 * texts (see contributionDeclaredSms/contributionConfirmedSms in
 * @esoqo/domain). The sending itself happens in the Server Action on
 * top — @esoqo/db cannot import @esoqo/auth, the dependency runs the
 * other way — which is the same split inviteMember already uses.
 *
 * Not ctx-gated, same precedent as findStalledGroups in dal/group-alerts.ts:
 * these are only ever called immediately after a capability-checked
 * write, by the caller that just performed it, to address a message
 * about that very write. Gating them again would mean an officer
 * confirming a contribution has to also hold treasury.read on a group
 * they just proved officership of.
 */

export interface ContributionNotifyDetail {
  orgId: string;
  orgName: string;
  contributorName: string;
  contributorMsisdn: string | null;
  amountKes: number;
  /** Short handle quoted in both texts so a member can match the two. */
  reference: string;
  newBalanceKes: number;
}

export async function getContributionNotifyDetail(
  contributionId: string,
): Promise<ContributionNotifyDetail | null> {
  const c = await prisma.groupContribution.findUnique({
    where: { id: contributionId },
    select: {
      id: true, orgId: true, amountKes: true,
      org: { select: { officialName: true, knownAs: true } },
      contributor: { select: { person: { select: { officialName: true, knownAs: true, msisdn: true } } } },
    },
  });
  if (!c) return null;
  const person = c.contributor.person;
  return {
    orgId: c.orgId,
    orgName: c.org.knownAs || c.org.officialName,
    contributorName: person?.knownAs || person?.officialName || 'a member',
    contributorMsisdn: person?.msisdn ?? null,
    amountKes: Number(c.amountKes),
    // Same first-8-of-the-id handle the Go API quotes (see
    // notifyContributionConfirmed in handlers_treasury.go), so the two
    // surfaces produce a reference a member can match across both.
    reference: c.id.slice(0, 8),
    newBalanceKes: await groupBalanceKes(c.orgId),
  };
}

/** Active members' phone numbers, for the confirmed-contribution
 *  fan-out. A member with no number on file is simply skipped — they're
 *  still a member, there is just nothing to send to. */
export async function activeMemberMsisdns(orgId: string): Promise<string[]> {
  const members = await prisma.membership.findMany({
    where: { orgId, exitedAt: null, status: 'ACTIVE' },
    select: { person: { select: { person: { select: { msisdn: true } } } } },
  });
  return members
    .map((m) => m.person.person?.msisdn)
    .filter((n): n is string => Boolean(n));
}

/* ── scheduled multisig withdrawal ───────────────────────── */

/**
 * Walks `from` forward by `leadMinutes` of ACTIVE-HOURS time — the
 * clock pauses outside [activeHoursStart, activeHoursEnd) and resumes
 * next activeHoursStart, so a request raised at 9pm doesn't quietly
 * expire while every signer is asleep. Server-local time; a per-group
 * timezone is a reasonable v2 addition, not needed while the pilot is
 * single-timezone.
 */
export function computeStandbyOpensAt(
  from: Date, leadMinutes: number, activeHoursStart: number, activeHoursEnd: number,
): Date {
  let remaining = leadMinutes;
  let cur = new Date(from);

  for (let guard = 0; guard < 2000 && remaining > 0; guard++) {
    const hour = cur.getHours();
    if (hour < activeHoursStart) {
      cur.setHours(activeHoursStart, 0, 0, 0);
      continue;
    }
    if (hour >= activeHoursEnd) {
      cur.setDate(cur.getDate() + 1);
      cur.setHours(activeHoursStart, 0, 0, 0);
      continue;
    }
    const windowEnd = new Date(cur);
    windowEnd.setHours(activeHoursEnd, 0, 0, 0);
    const minutesLeftInWindow = (windowEnd.getTime() - cur.getTime()) / 60_000;
    const consume = Math.min(remaining, minutesLeftInWindow);
    cur = new Date(cur.getTime() + consume * 60_000);
    remaining -= consume;
  }
  return cur;
}

function signWithdrawalSignature(withdrawalId: string, signerId: string, decision: string, at: Date): string {
  return createHmac('sha256', SECRET)
    .update(`${withdrawalId}|${signerId}|${decision}|${at.toISOString()}`)
    .digest('hex');
}

export function verifyWithdrawalSignature(a: {
  withdrawalId: string; signerId: string; decision: string; signedAt: Date; signature: string;
}): boolean {
  const expected = Buffer.from(signWithdrawalSignature(a.withdrawalId, a.signerId, a.decision, a.signedAt), 'hex');
  const actual = Buffer.from(a.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface RequestWithdrawalInput {
  orgId: string;
  amountKes: number;
  purpose: string;
  payeeName: string;
  payeeMsisdn?: string;
  meetingId?: string;
}

/**
 * Broadcasts a proposed withdrawal to every eligible signer and, as an
 * informational copy, every member — see dal/treasury.ts module doc
 * and the proposal for why the standby window is a cooling-off period,
 * not a signature deadline: execution requires BOTH the threshold and
 * the window elapsing, never whichever comes first.
 */
export async function requestWithdrawal(ctx: Ctx, input: RequestWithdrawalInput) {
  requireCapability(ctx, 'treasury.withdraw.request', { partyId: ctx.partyId });
  await assertActiveMember(input.orgId, ctx.partyId!);
  if (!(await isOfficer(input.orgId, ctx.partyId!))) {
    throw new TreasuryError('Only your group’s officers can propose a withdrawal', 'NOT_AN_OFFICER');
  }
  if (!(input.amountKes > 0)) throw new Error('Enter an amount above zero');
  if (!input.purpose.trim()) throw new Error('State what the withdrawal is for');

  const account = await prisma.account.findFirst({ where: { partyId: input.orgId, kind: 'GROUP_SAVINGS' } });
  if (!account) throw new TreasuryError('This group has no savings account yet', 'NOT_FOUND');

  const balance = await getGroupBalance(ctx, input.orgId);
  if (input.amountKes > balance) throw new Error('That is more than the group currently holds');

  const policy = await getTreasuryPolicy(ctx, input.orgId);
  if (policy.requireQuorateMeeting) {
    const meeting = input.meetingId
      ? await prisma.meeting.findUnique({ where: { id: input.meetingId }, include: { attendance: true } })
      : null;
    const present = meeting?.attendance.filter((a) => a.present).length ?? 0;
    const activeCount = await prisma.membership.count({ where: { orgId: input.orgId, exitedAt: null } });
    const quorate = meeting && activeCount > 0 && (present / activeCount) * 100 >= meeting.quorumPct;
    if (!quorate) {
      throw new Error('This group requires a quorate meeting behind a withdrawal request');
    }
  }

  const now = new Date();
  const standbyOpensAt = computeStandbyOpensAt(
    now, policy.withdrawalLeadMinutes, policy.activeHoursStart, policy.activeHoursEnd,
  );

  const withdrawal = await prisma.withdrawalRequest.create({
    data: {
      orgId: input.orgId, accountId: account.id, meetingId: input.meetingId,
      requestedById: ctx.partyId!, amountKes: input.amountKes, purpose: input.purpose.trim(),
      payeeName: input.payeeName.trim(), payeeMsisdn: input.payeeMsisdn,
      requiredSigners: policy.requiredSigners, broadcastAt: now, standbyOpensAt,
    },
  });

  await recordAudit(ctx, {
    action: 'treasury.withdrawal.requested', targetType: 'withdrawal_request', targetId: withdrawal.id,
    payload: { orgId: input.orgId, amountKes: input.amountKes, standbyOpensAt: standbyOpensAt.toISOString() },
  });
  return withdrawal;
}

export interface SignWithdrawalInput {
  withdrawalId: string;
  decision: ApprovalDecision;
  pin: string;
}

/**
 * A live, present-tense PIN signature — never queued, never replayed.
 * Verifies the PIN itself (Argon2id) rather than trusting a caller's
 * "pinVerified" flag, so a step-up check can never be spoofed by a
 * client that skips it.
 */
export async function signWithdrawal(ctx: Ctx, input: SignWithdrawalInput) {
  requireCapability(ctx, 'treasury.withdraw.sign', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new TreasuryError('Sign in required', 'NOT_A_MEMBER');

  const credential = await prisma.userCredential.findUnique({ where: { personId: ctx.partyId } });
  if (!credential?.pinHash) throw new TreasuryError('Set a PIN before signing', 'NO_PIN_SET');
  const pinOk = await verifyArgon2(credential.pinHash, input.pin).catch(() => false);
  if (!pinOk) throw new TreasuryError('Wrong PIN', 'WRONG_PIN');

  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawalRequest.findUnique({
      where: { id: input.withdrawalId }, include: { signatures: true },
    });
    if (!withdrawal) throw new TreasuryError('Withdrawal request not found', 'NOT_FOUND');
    if (withdrawal.status !== 'PENDING_SIGNATURES') {
      throw new TreasuryError('This withdrawal has already been decided', 'ALREADY_SETTLED');
    }

    const signerIds = await getEffectiveSignerIds(withdrawal.orgId);
    if (!signerIds.includes(ctx.partyId!)) {
      throw new TreasuryError('You are not a signer for this group', 'NOT_A_SIGNER');
    }
    if (withdrawal.signatures.some((s) => s.signerId === ctx.partyId)) {
      throw new TreasuryError('You have already signed this withdrawal', 'ALREADY_SIGNED');
    }

    const signedAt = new Date();
    await tx.withdrawalSignature.create({
      data: {
        withdrawalId: input.withdrawalId, signerId: ctx.partyId!, decision: input.decision,
        pinVerifiedAt: signedAt, signedAt, ip: ctx.ip,
        signature: signWithdrawalSignature(input.withdrawalId, ctx.partyId!, input.decision, signedAt),
      },
    });

    // One rejection halts immediately — does not wait for the window.
    if (input.decision === 'REJECT') {
      const updated = await tx.withdrawalRequest.update({
        where: { id: input.withdrawalId }, data: { status: 'REJECTED', decidedAt: signedAt },
      });
      await recordAudit(ctx, {
        action: 'treasury.withdrawal.rejected', targetType: 'withdrawal_request', targetId: input.withdrawalId,
      }, tx as never);
      return { withdrawal: updated, executed: false };
    }

    await recordAudit(ctx, {
      action: 'treasury.withdrawal.signed', targetType: 'withdrawal_request', targetId: input.withdrawalId,
      payload: { decision: input.decision },
    }, tx as never);

    return { withdrawal, executed: false };
  });
}

/**
 * Executes an approved withdrawal — called once the standby window has
 * elapsed AND enough signatures are on file (never either alone). This
 * is meant to run from a scheduled sweep (services/core, SYSTEM ctx),
 * mirroring the "checked periodically, not on a per-request timer"
 * pattern the rest of the platform uses for anything time-gated.
 */
export async function executeWithdrawalIfDue(withdrawalId: string) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawalRequest.findUnique({
      where: { id: withdrawalId }, include: { signatures: true },
    });
    if (!withdrawal) throw new TreasuryError('Withdrawal request not found', 'NOT_FOUND');
    if (withdrawal.status !== 'PENDING_SIGNATURES') return withdrawal;
    if (new Date() < withdrawal.standbyOpensAt) {
      throw new TreasuryError('The standby window has not elapsed yet', 'WINDOW_NOT_ELAPSED');
    }

    const approvals = withdrawal.signatures.filter((s) => s.decision === 'APPROVE').length;
    if (approvals < withdrawal.requiredSigners) {
      const expired = await tx.withdrawalRequest.update({
        where: { id: withdrawalId }, data: { status: 'EXPIRED', decidedAt: new Date() },
      });
      await recordAudit(systemCtx('withdrawal-sweep'), {
        action: 'treasury.withdrawal.expired', targetType: 'withdrawal_request', targetId: withdrawalId,
        payload: { approvals, required: withdrawal.requiredSigners },
      }, tx as never);
      return expired;
    }

    const settlement = await findOrCreateSettlementAccount(tx);
    const entry = await tx.journalEntry.create({
      data: {
        reference: `WITHDRAWAL-${withdrawal.id}`,
        description: `Withdrawal: ${withdrawal.purpose}`,
        postings: {
          create: [
            { accountId: withdrawal.accountId, amount: -Number(withdrawal.amountKes) },
            { accountId: settlement.id, amount: Number(withdrawal.amountKes) },
          ],
        },
      },
    });

    const executed = await tx.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: { status: 'EXECUTED', decidedAt: new Date(), journalEntryId: entry.id },
    });

    await recordAudit(systemCtx('withdrawal-sweep'), {
      action: 'treasury.withdrawal.executed', targetType: 'withdrawal_request', targetId: withdrawalId,
      payload: { amountKes: Number(withdrawal.amountKes), payeeName: withdrawal.payeeName },
    }, tx as never);

    return executed;
  });
}

export async function listWithdrawals(ctx: Ctx, orgId: string, take = 20) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  const rows = await prisma.withdrawalRequest.findMany({
    where: { orgId },
    include: {
      requestedBy: { include: { person: true } },
      signatures: { include: { signer: { include: { person: true } } } },
    },
    orderBy: { broadcastAt: 'desc' },
    take,
  });
  return rows.map((w) => ({
    ...w,
    amountKes: Number(w.amountKes),
    approveCount: w.signatures.filter((s) => s.decision === 'APPROVE').length,
    signatures: w.signatures.map((s) => ({ ...s, valid: verifyWithdrawalSignature(s) })),
  }));
}

export async function getWithdrawal(ctx: Ctx, withdrawalId: string) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  const w = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: {
      requestedBy: { include: { person: true } },
      signatures: { include: { signer: { include: { person: true } } }, orderBy: { signedAt: 'asc' } },
    },
  });
  if (!w) return null;
  await assertActiveMember(w.orgId, ctx.partyId!);
  const signerIds = await getEffectiveSignerIds(w.orgId);
  return {
    ...w,
    amountKes: Number(w.amountKes),
    approveCount: w.signatures.filter((s) => s.decision === 'APPROVE').length,
    canSign: signerIds.includes(ctx.partyId!) && !w.signatures.some((s) => s.signerId === ctx.partyId)
      && w.status === 'PENDING_SIGNATURES',
    signatures: w.signatures.map((s) => ({ ...s, valid: verifyWithdrawalSignature(s) })),
  };
}
