import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import {
  TreasuryError, assertActiveMember, findOrCreateGroupSavingsAccount,
  findOrCreateSettlementAccount, groupBalanceKes, recordGroupActivity,
} from './treasury';
import type { ApprovalDecision } from '@prisma/client';

/**
 * Named funding kitties inside a group — "Grace funeral", "Midai
 * wedding" — see the GroupProject model's own doc comment in
 * schema.prisma for the full shape and why it shares the group's one
 * GROUP_SAVINGS account rather than getting its own.
 *
 * Deliberately simpler than dal/treasury.ts's WithdrawalRequest: no
 * broadcast/standby cooling-off window, and its own signer list
 * (GroupProjectSigner) rather than the group's GroupSigner — the same
 * instant-tally-on-vote shape createProposal/castProposalVote use, not
 * the time-gated one, because a kitty this scoped doesn't carry the
 * same cooling-off requirement the whole group's treasury does.
 */

export interface CreateProjectInput {
  orgId: string;
  title: string;
  purpose?: string;
  targetKes?: number;
  /** Other members to add as this project's own signers, beyond the
   *  creator (who is always one). */
  signerIds?: string[];
  requiredApprovals?: number;
}

export async function createGroupProject(ctx: Ctx, input: CreateProjectInput) {
  requireCapability(ctx, 'treasury.policy.write', { partyId: ctx.partyId });
  await assertActiveMember(input.orgId, ctx.partyId!);
  if (!input.title.trim()) throw new Error('Give this project a name');

  const signerIds = Array.from(new Set([ctx.partyId!, ...(input.signerIds ?? [])]));
  for (const id of signerIds) await assertActiveMember(input.orgId, id);

  const project = await prisma.groupProject.create({
    data: {
      orgId: input.orgId, title: input.title.trim(), purpose: input.purpose?.trim() || null,
      targetKes: input.targetKes ?? null, createdById: ctx.partyId!,
      requiredApprovals: Math.max(1, input.requiredApprovals ?? 1),
      signers: { create: signerIds.map((personId) => ({ personId })) },
    },
  });
  await recordAudit(ctx, {
    action: 'treasury.project.created', targetType: 'group_project', targetId: project.id,
    payload: { orgId: input.orgId, title: input.title },
  });
  await recordGroupActivity(input.orgId, 'MEMBER_JOINED', `Started a project: ${input.title.trim()}`, ctx.partyId);
  return project;
}

export async function listGroupProjects(ctx: Ctx, orgId: string) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  await assertActiveMember(orgId, ctx.partyId!);
  const projects = await prisma.groupProject.findMany({
    where: { orgId },
    include: { signers: { where: { removedAt: null }, include: { person: { include: { person: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  const projectIds = projects.map((p) => p.id);
  const [raised, pendingContributions, pendingWithdrawals] = await Promise.all([
    prisma.groupProjectContribution.groupBy({
      by: ['projectId'], where: { projectId: { in: projectIds }, status: 'CONFIRMED' }, _sum: { amountKes: true },
    }),
    prisma.groupProjectContribution.findMany({
      where: { projectId: { in: projectIds }, status: 'DECLARED' },
      include: { contributor: { include: { person: true } } },
      orderBy: { declaredAt: 'asc' },
    }),
    prisma.groupProjectWithdrawal.findMany({
      where: { projectId: { in: projectIds }, status: 'PENDING_SIGNATURES' },
      include: { votes: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const raisedByProject = new Map(raised.map((r) => [r.projectId, Number(r._sum.amountKes ?? 0)]));
  return projects.map((p) => ({
    ...p,
    raisedKes: raisedByProject.get(p.id) ?? 0,
    pendingContributions: pendingContributions.filter((c) => c.projectId === p.id),
    pendingWithdrawals: pendingWithdrawals
      .filter((w) => w.projectId === p.id)
      .map((w) => ({ ...w, approvals: w.votes.filter((v) => v.decision === 'APPROVE').length })),
  }));
}

async function projectSignerIds(projectId: string): Promise<string[]> {
  const rows = await prisma.groupProjectSigner.findMany({ where: { projectId, removedAt: null }, select: { personId: true } });
  return rows.map((r) => r.personId);
}

async function getProjectOrThrow(projectId: string) {
  const project = await prisma.groupProject.findUnique({ where: { id: projectId } });
  if (!project) throw new TreasuryError('Project not found', 'NOT_FOUND');
  return project;
}

/* ── contributions: declare, then confirm ─────────────────────────── */

export async function declareProjectContribution(ctx: Ctx, projectId: string, input: { amountKes: number; reference?: string }) {
  requireCapability(ctx, 'treasury.contribute', { partyId: ctx.partyId });
  const project = await getProjectOrThrow(projectId);
  await assertActiveMember(project.orgId, ctx.partyId!);
  if (project.status !== 'ACTIVE') throw new TreasuryError('This project is closed', 'NOT_PENDING');
  if (!(input.amountKes > 0)) throw new Error('Enter an amount above zero');

  const contribution = await prisma.groupProjectContribution.create({
    data: { projectId, contributorId: ctx.partyId!, amountKes: input.amountKes, reference: input.reference?.trim() || null },
  });
  await recordAudit(ctx, {
    action: 'treasury.project_contribution.declared', targetType: 'group_project_contribution', targetId: contribution.id,
    payload: { projectId, amountKes: input.amountKes },
  });
  return contribution;
}

/** An officer's confirmation posts the real ledger entry — the same
 *  +GROUP_SAVINGS/-SETTLEMENT shape a plain GroupContribution posts,
 *  because to the group's own balance a confirmed project contribution
 *  is exactly that: real money that arrived. */
export async function confirmProjectContribution(ctx: Ctx, contributionId: string) {
  requireCapability(ctx, 'treasury.confirm', { partyId: ctx.partyId });
  const contribution = await prisma.groupProjectContribution.findUnique({
    where: { id: contributionId }, include: { project: true },
  });
  if (!contribution) throw new TreasuryError('Contribution not found', 'NOT_FOUND');
  if (contribution.status === 'CONFIRMED') return { contribution, alreadyConfirmed: true };

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.groupProjectContribution.updateMany({
      where: { id: contributionId, status: 'DECLARED' },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ctx.partyId! },
    });
    if (claimed.count === 0) return null;

    const [savings, settlement] = await Promise.all([
      findOrCreateGroupSavingsAccount(tx, contribution.project.orgId),
      findOrCreateSettlementAccount(tx),
    ]);
    const entry = await tx.journalEntry.create({
      data: {
        reference: `PROJECT-CONTRIBUTION-${contribution.id}`,
        description: `Contribution to ${contribution.project.title}`,
        postings: {
          create: [
            { accountId: savings.id, amount: Number(contribution.amountKes) },
            { accountId: settlement.id, amount: -Number(contribution.amountKes) },
          ],
        },
      },
    });
    return tx.groupProjectContribution.update({ where: { id: contributionId }, data: { journalEntryId: entry.id } });
  });
  if (!updated) return { contribution, alreadyConfirmed: true };

  await recordAudit(ctx, {
    action: 'treasury.project_contribution.confirmed', targetType: 'group_project_contribution', targetId: contributionId,
  });
  await recordGroupActivity(
    contribution.project.orgId, 'CONTRIBUTION_CONFIRMED',
    `KES ${Number(contribution.amountKes).toLocaleString('en-KE')} confirmed for ${contribution.project.title}`,
    ctx.partyId,
  );
  return { contribution: updated, alreadyConfirmed: false };
}

/* ── withdrawal: instant-tally vote among the project's own signers ── */

export async function requestProjectWithdrawal(
  ctx: Ctx, projectId: string, input: { amountKes: number; purpose: string; payeeName: string },
) {
  requireCapability(ctx, 'treasury.withdraw.request', { partyId: ctx.partyId });
  const project = await getProjectOrThrow(projectId);
  await assertActiveMember(project.orgId, ctx.partyId!);
  const signerIds = await projectSignerIds(projectId);
  if (signerIds.length > 0 && !signerIds.includes(ctx.partyId!)) {
    throw new TreasuryError('Only this project’s signatories can request a withdrawal', 'NOT_A_SIGNER');
  }
  if (!(input.amountKes > 0)) throw new Error('Enter an amount above zero');

  const balance = await groupBalanceKes(project.orgId);
  if (input.amountKes > balance) throw new Error('That is more than the group currently holds');

  const withdrawal = await prisma.groupProjectWithdrawal.create({
    data: {
      projectId, requestedById: ctx.partyId!, amountKes: input.amountKes,
      purpose: input.purpose.trim(), payeeName: input.payeeName.trim(),
      requiredApprovals: project.requiredApprovals,
    },
  });
  await recordGroupActivity(
    project.orgId, 'WITHDRAWAL_REQUESTED',
    `Requested KES ${input.amountKes.toLocaleString('en-KE')} from ${project.title} for ${input.purpose.trim()}`,
    ctx.partyId,
  );
  return withdrawal;
}

export async function voteProjectWithdrawal(ctx: Ctx, withdrawalId: string, decision: ApprovalDecision) {
  requireCapability(ctx, 'treasury.withdraw.sign', { partyId: ctx.partyId });
  const withdrawal = await prisma.groupProjectWithdrawal.findUnique({
    where: { id: withdrawalId }, include: { votes: true, project: true },
  });
  if (!withdrawal) throw new TreasuryError('Withdrawal not found', 'NOT_FOUND');
  if (withdrawal.status !== 'PENDING_SIGNATURES') throw new TreasuryError('Already decided', 'ALREADY_SETTLED');

  const signerIds = await projectSignerIds(withdrawal.projectId);
  const eligible = signerIds.length > 0 ? signerIds : [withdrawal.project.createdById];
  if (!eligible.includes(ctx.partyId!)) throw new TreasuryError('You are not a signatory for this project', 'NOT_A_SIGNER');
  if (withdrawal.votes.some((v) => v.voterId === ctx.partyId)) throw new TreasuryError('Already voted', 'ALREADY_SIGNED');

  await prisma.groupProjectWithdrawalVote.create({ data: { withdrawalId, voterId: ctx.partyId!, decision } });

  const approvals = withdrawal.votes.filter((v) => v.decision === 'APPROVE').length + (decision === 'APPROVE' ? 1 : 0);
  const rejections = withdrawal.votes.filter((v) => v.decision === 'REJECT').length + (decision === 'REJECT' ? 1 : 0);
  const stillPossible = eligible.length - rejections >= withdrawal.requiredApprovals;

  if (approvals >= withdrawal.requiredApprovals) {
    await executeProjectWithdrawal(ctx, withdrawal.id);
    return { status: 'EXECUTED' as const };
  }
  if (!stillPossible) {
    await prisma.groupProjectWithdrawal.update({ where: { id: withdrawal.id }, data: { status: 'REJECTED', decidedAt: new Date() } });
    await recordGroupActivity(withdrawal.project.orgId, 'WITHDRAWAL_REJECTED', `A withdrawal from ${withdrawal.project.title} was voted down`);
    return { status: 'REJECTED' as const };
  }
  return { status: 'OPEN' as const, approvals, rejections, needed: withdrawal.requiredApprovals };
}

async function executeProjectWithdrawal(ctx: Ctx, withdrawalId: string): Promise<void> {
  const withdrawal = await prisma.groupProjectWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId }, include: { project: true } });

  const entryId = await prisma.$transaction(async (tx) => {
    const [savings, settlement] = await Promise.all([
      findOrCreateGroupSavingsAccount(tx, withdrawal.project.orgId),
      findOrCreateSettlementAccount(tx),
    ]);
    const entry = await tx.journalEntry.create({
      data: {
        reference: `PROJECT-WITHDRAWAL-${withdrawal.id}`,
        description: `Withdrawal: ${withdrawal.purpose}`,
        postings: {
          create: [
            { accountId: savings.id, amount: -Number(withdrawal.amountKes) },
            { accountId: settlement.id, amount: Number(withdrawal.amountKes) },
          ],
        },
      },
    });
    await tx.groupProjectWithdrawal.update({
      where: { id: withdrawalId }, data: { status: 'EXECUTED', decidedAt: new Date(), journalEntryId: entry.id },
    });
    return entry.id;
  });

  await recordAudit(ctx, {
    action: 'treasury.project_withdrawal.executed', targetType: 'group_project_withdrawal', targetId: withdrawalId,
    payload: { journalEntryId: entryId, amountKes: Number(withdrawal.amountKes) },
  });
  await recordGroupActivity(
    withdrawal.project.orgId, 'WITHDRAWAL_EXECUTED',
    `KES ${Number(withdrawal.amountKes).toLocaleString('en-KE')} paid from ${withdrawal.project.title} to ${withdrawal.payeeName}`,
  );
}

export async function listProjectWithdrawals(ctx: Ctx, projectId: string) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  const project = await getProjectOrThrow(projectId);
  await assertActiveMember(project.orgId, ctx.partyId!);
  return prisma.groupProjectWithdrawal.findMany({
    where: { projectId },
    include: { requestedBy: { include: { person: true } }, votes: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listProjectContributions(ctx: Ctx, projectId: string) {
  requireCapability(ctx, 'treasury.read', { partyId: ctx.partyId });
  const project = await getProjectOrThrow(projectId);
  await assertActiveMember(project.orgId, ctx.partyId!);
  return prisma.groupProjectContribution.findMany({
    where: { projectId },
    include: { contributor: { include: { person: true } } },
    orderBy: { declaredAt: 'desc' },
  });
}
