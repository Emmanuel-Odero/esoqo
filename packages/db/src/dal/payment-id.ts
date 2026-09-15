import { randomInt } from 'node:crypto';
import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * Esoqo Payment ID and the derived Group Credit Insight snapshot.
 *
 * See docs/proposals/esoqo-group-treasury-and-payment-id.md §5 and the
 * GroupCreditInsightSnapshot model doc comment for the reasoning. Two
 * rules that matter:
 *
 *   · The ID reuses Attestation, the platform's existing trust
 *     primitive — it does not invent a second verification path.
 *   · A snapshot is computed fresh each time it's requested, from
 *     events this schema already produces. It is never a live-updating
 *     score column, for the same reason a balance is never stored.
 */

export class PaymentIdError extends Error {
  constructor(msg: string, public readonly code: 'NOT_VERIFIED' | 'ALREADY_ISSUED') {
    super(msg);
    this.name = 'PaymentIdError';
  }
}

function generateCode(): string {
  return `ESK-${randomInt(1000, 9999)}-KE`;
}

/** Issues a Payment ID once the subject holds MSISDN_VERIFIED — the
 *  same verification the sign-in/registration flow already produces. */
export async function issueEsoqoPaymentId(ctx: Ctx) {
  requireCapability(ctx, 'paymentid.issue', { partyId: ctx.partyId });
  if (!ctx.partyId) throw new Error('Sign in required');

  const existing = await prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
  if (existing) return existing;

  const verified = await prisma.attestation.findFirst({
    where: { subjectId: ctx.partyId, claimType: 'MSISDN_VERIFIED', revokedAt: null },
  });
  if (!verified) {
    throw new PaymentIdError('Verify your phone number before activating a Payment ID', 'NOT_VERIFIED');
  }

  // Extremely low collision odds at pilot scale (9000 codes); retried
  // once on the rare clash rather than looping indefinitely.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const clash = await prisma.esoqoPaymentId.findUnique({ where: { code } });
    if (clash) continue;

    const issued = await prisma.esoqoPaymentId.create({ data: { partyId: ctx.partyId, code } });
    await recordAudit(ctx, {
      action: 'paymentid.issued', targetType: 'esoko_payment_id', targetId: ctx.partyId,
      payload: { code },
    });
    return issued;
  }
  throw new Error('Could not allocate a Payment ID — try again');
}

export async function getMyPaymentId(ctx: Ctx) {
  if (!ctx.partyId) return null;
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });
  return prisma.esoqoPaymentId.findUnique({ where: { partyId: ctx.partyId } });
}

/* ── Group Credit Insight snapshot (v1) ──────────────────────
 *
 * v1 inputs are strictly the events this schema already produces:
 * contribution consistency, attendance reliability, and signature
 * responsiveness/reject-rate. Loan-repayment behaviour is deliberately
 * left out until an internal-lending feature exists to produce that
 * outcome — scoring against an event type that can't yet occur would
 * be inventing data, not deriving it.
 */

const FORMULA_VERSION = 'v1-2026-08';
const LOOKBACK_DAYS = 180;

function scoreFromRatio(numerator: number, denominator: number, floor = 40): number {
  if (denominator === 0) return floor; // no history yet — neutral-low, not zero
  return Math.round(Math.min(100, Math.max(floor, (numerator / denominator) * 100)));
}

/** Computes a fresh snapshot — does not persist unless a caller asks
 *  it to be recorded (see recordInsightSnapshot below). */
export async function computeCreditInsight(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'portfolio.read', { partyId: ctx.partyId });
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [declared, confirmed, attendance, signatures] = await Promise.all([
    prisma.groupContribution.count({ where: { contributorId: partyId, createdAt: { gte: since } } }),
    prisma.groupContribution.count({
      where: { contributorId: partyId, status: 'CONFIRMED', createdAt: { gte: since } },
    }),
    prisma.attendanceRecord.findMany({ where: { personId: partyId, markedAt: { gte: since } } }),
    prisma.withdrawalSignature.findMany({ where: { signerId: partyId, signedAt: { gte: since } } }),
  ]);

  const attendancePresent = attendance.filter((a) => a.present).length;
  const signatureRejects = signatures.filter((s) => s.decision === 'REJECT').length;

  return {
    formulaVersion: FORMULA_VERSION,
    contributionScore: scoreFromRatio(confirmed, declared),
    attendanceScore: scoreFromRatio(attendancePresent, attendance.length),
    // Responsiveness matters more than reject-rate here — signing at
    // all, promptly, is the trust signal; a REJECT is doing the job
    // correctly, not a strike, so it only shaves a little rather than
    // tanking the score.
    signatureScore: signatures.length === 0 ? 60 : Math.max(40, 100 - signatureRejects * 10),
  };
}

/** Persists a snapshot — the record of "what was computed and shown,"
 *  optionally tied to the ConsentAccess that justified sharing it. */
export async function recordInsightSnapshot(
  ctx: Ctx, partyId: string, disclosedViaConsentAccessId?: string,
) {
  const insight = await computeCreditInsight(ctx, partyId);
  const snapshot = await prisma.groupCreditInsightSnapshot.create({
    data: { partyId, ...insight, disclosedViaConsentAccessId },
  });
  await recordAudit(ctx, {
    action: 'portfolio.snapshot_recorded', targetType: 'group_credit_insight_snapshot', targetId: snapshot.id,
    payload: { partyId, disclosed: Boolean(disclosedViaConsentAccessId) },
  });
  return snapshot;
}

export async function getMyCreditInsight(ctx: Ctx) {
  if (!ctx.partyId) return null;
  return computeCreditInsight(ctx, ctx.partyId);
}
