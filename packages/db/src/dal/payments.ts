import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../client';
import { requireCapability, PAYMENT_APPROVAL_THRESHOLD, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { PaymentMethod, ApprovalDecision } from '@prisma/client';

/**
 * Registration payments and the signature chain.
 *
 * The rule that matters: a declaration is not money. A joiner saying
 * "I paid, here is the M-Pesa code" changes nothing about their standing.
 * Only a chain of signatures from distinct, authorised approvers moves a
 * payment to CONFIRMED.
 *
 * Separation of duties is enforced HERE, not by convention:
 *   · an approver may sign a given payment exactly once (DB unique index)
 *   · nobody may approve a payment they recorded or amended
 *   · only staff holding `payment.approve` may sign at all
 *   · a single REJECT halts the chain — money disputes escalate to a human
 */

const SECRET = process.env.SESSION_SECRET ?? 'dev-signing-secret';

function sign(paymentId: string, approverId: string, decision: string, at: Date): string {
  return createHmac('sha256', SECRET)
    .update(`${paymentId}|${approverId}|${decision}|${at.toISOString()}`)
    .digest('hex');
}

export function verifySignature(a: {
  paymentId: string; approverId: string; decision: string; signedAt: Date; signature: string;
}): boolean {
  const expected = Buffer.from(sign(a.paymentId, a.approverId, a.decision, a.signedAt), 'hex');
  const actual = Buffer.from(a.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class PaymentError extends Error {
  constructor(msg: string, public readonly code:
    'ALREADY_SIGNED' | 'SELF_APPROVAL' | 'NOT_DECLARED' | 'ALREADY_SETTLED' | 'NOT_FOUND') {
    super(msg);
    this.name = 'PaymentError';
  }
}

/* ── the joiner declares ─────────────────────────────────── */

export interface DeclarePaymentInput {
  method: PaymentMethod;
  reference?: string;
  amountKes?: number;
  note?: string;
}

export async function declarePayment(ctx: Ctx, registrationId: string, input: DeclarePaymentInput) {
  requireCapability(ctx, 'registration.write', { registrationId });

  const payment = await prisma.registrationPayment.upsert({
    where: { registrationId },
    create: {
      registrationId,
      method: input.method,
      reference: input.reference?.trim().toUpperCase(),
      amountKes: input.amountKes,
      declaredNote: input.note,
      declaredAt: new Date(),
      status: 'DECLARED',
    },
    update: {
      method: input.method,
      reference: input.reference?.trim().toUpperCase(),
      amountKes: input.amountKes,
      declaredNote: input.note,
      declaredAt: new Date(),
      status: 'DECLARED',
    },
  });

  await recordAudit(ctx, {
    action: 'payment.declared',
    targetType: 'payment',
    targetId: payment.id,
    // The reference is a financial identifier, so it is recorded — but
    // never the amount alongside a phone number in the same event.
    payload: { method: input.method, hasReference: Boolean(input.reference) },
  });

  return payment;
}

/** "I will pay later." A legitimate choice that must not block joining. */
export async function deferPayment(ctx: Ctx, registrationId: string) {
  requireCapability(ctx, 'registration.write', { registrationId });
  const payment = await prisma.registrationPayment.upsert({
    where: { registrationId },
    create: { registrationId, status: 'NOT_DECLARED' },
    update: { status: 'NOT_DECLARED', declaredAt: null, reference: null },
  });
  await recordAudit(ctx, {
    action: 'payment.deferred', targetType: 'payment', targetId: payment.id,
  });
  return payment;
}

/* ── staff record or amend ───────────────────────────────── */

export async function recordPayment(
  ctx: Ctx,
  paymentId: string,
  input: DeclarePaymentInput & { amountKes: number },
) {
  requireCapability(ctx, 'payment.record');

  const existing = await prisma.registrationPayment.findUnique({ where: { id: paymentId } });
  if (!existing) throw new PaymentError('Payment not found', 'NOT_FOUND');
  if (existing.status === 'CONFIRMED') {
    throw new PaymentError('This payment is already confirmed and cannot be amended', 'ALREADY_SETTLED');
  }

  const payment = await prisma.registrationPayment.update({
    where: { id: paymentId },
    data: {
      method: input.method,
      reference: input.reference?.trim().toUpperCase(),
      amountKes: input.amountKes,
      declaredNote: input.note,
      status: 'DECLARED',
    },
  });

  await recordAudit(ctx, {
    action: 'payment.recorded',
    targetType: 'payment',
    targetId: paymentId,
    // Recorded so the separation-of-duties check below can find it.
    payload: { recordedBy: ctx.actorId, amountKes: input.amountKes },
  });

  return payment;
}

/* ── the signature chain ─────────────────────────────────── */

export interface SignInput {
  paymentId: string;
  decision: ApprovalDecision;
  note?: string;
}

export async function signPaymentApproval(ctx: Ctx, input: SignInput) {
  requireCapability(ctx, 'payment.approve');
  if (!ctx.actorId) throw new PaymentError('Approvals require a named staff account', 'NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.registrationPayment.findUnique({
      where: { id: input.paymentId },
      include: { approvals: true },
    });
    if (!payment) throw new PaymentError('Payment not found', 'NOT_FOUND');
    if (payment.status === 'CONFIRMED' || payment.status === 'REJECTED') {
      throw new PaymentError('This payment has already been settled', 'ALREADY_SETTLED');
    }
    if (payment.status === 'NOT_DECLARED') {
      throw new PaymentError('Nothing has been declared for this registration yet', 'NOT_DECLARED');
    }

    // Separation of duties — you cannot approve what you recorded.
    const recordedByMe = await tx.auditEvent.findFirst({
      where: {
        action: 'payment.recorded',
        targetId: input.paymentId,
        actorId: ctx.actorId,
      },
    });
    if (recordedByMe) {
      throw new PaymentError(
        'You recorded this payment, so you cannot also approve it. Ask a colleague.',
        'SELF_APPROVAL',
      );
    }

    if (payment.approvals.some((a) => a.approverId === ctx.actorId)) {
      throw new PaymentError('You have already signed this payment', 'ALREADY_SIGNED');
    }

    const signedAt = new Date();
    await tx.paymentApproval.create({
      data: {
        paymentId: input.paymentId,
        approverId: ctx.actorId!,
        decision: input.decision,
        note: input.note,
        signature: sign(input.paymentId, ctx.actorId!, input.decision, signedAt),
        signedAt,
        ip: ctx.ip,
      },
    });

    const approvals = [...payment.approvals, { decision: input.decision } as { decision: ApprovalDecision }];
    const approves = approvals.filter((a) => a.decision === 'APPROVE').length;
    const rejects = approvals.filter((a) => a.decision === 'REJECT').length;

    // One rejection halts the chain. Money disputes go to a human.
    let status = payment.status;
    let confirmedAt: Date | null = null;
    if (rejects > 0) status = 'REJECTED';
    else if (approves >= PAYMENT_APPROVAL_THRESHOLD) { status = 'CONFIRMED'; confirmedAt = signedAt; }
    else status = 'UNDER_REVIEW';

    const updated = await tx.registrationPayment.update({
      where: { id: input.paymentId },
      data: { status, confirmedAt },
    });

    await recordAudit(
      ctx,
      {
        action: status === 'CONFIRMED' ? 'payment.confirmed' : 'payment.signed',
        targetType: 'payment',
        targetId: input.paymentId,
        payload: {
          decision: input.decision,
          signatures: approvals.length,
          threshold: PAYMENT_APPROVAL_THRESHOLD,
          resultingStatus: status,
        },
      },
      tx as never,
    );

    return { payment: updated, signatures: approvals.length, needed: PAYMENT_APPROVAL_THRESHOLD };
  });
}

export async function waivePayment(ctx: Ctx, paymentId: string, reason: string) {
  requireCapability(ctx, 'payment.waive');
  const payment = await prisma.registrationPayment.update({
    where: { id: paymentId },
    data: { status: 'WAIVED', confirmedAt: new Date(), declaredNote: reason },
  });
  await recordAudit(ctx, {
    action: 'payment.waived', targetType: 'payment', targetId: paymentId, payload: { reason },
  });
  return payment;
}

/* ── reads ───────────────────────────────────────────────── */

export async function getPayment(ctx: Ctx, paymentId: string) {
  requireCapability(ctx, 'payment.read');
  const p = await prisma.registrationPayment.findUnique({
    where: { id: paymentId },
    include: {
      registration: true,
      approvals: { include: { approver: { select: { id: true, name: true, email: true } } },
                   orderBy: { signedAt: 'asc' } },
    },
  });
  if (!p) return null;
  return {
    ...p,
    amountKes: p.amountKes ? Number(p.amountKes) : null,
    approvals: p.approvals.map((a) => ({
      ...a,
      // Every signature is re-verified on read. A tampered row shows up
      // in the UI as "signature invalid", not as a valid approval.
      valid: verifySignature(a),
    })),
    threshold: PAYMENT_APPROVAL_THRESHOLD,
  };
}

export interface PaymentFilter {
  status?: 'NOT_DECLARED' | 'DECLARED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'WAIVED';
  search?: string;
  take?: number;
  skip?: number;
}

export async function listPayments(ctx: Ctx, f: PaymentFilter = {}) {
  requireCapability(ctx, 'payment.read');

  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.search
      ? {
          OR: [
            { reference: { contains: f.search.toUpperCase() } },
            { registration: { officialName: { contains: f.search, mode: 'insensitive' as const } } },
            { registration: { msisdn: { contains: f.search } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.registrationPayment.findMany({
      where,
      include: {
        registration: { select: { id: true, officialName: true, knownAs: true, msisdn: true, county: true } },
        approvals: { include: { approver: { select: { name: true } } }, orderBy: { signedAt: 'asc' } },
      },
      orderBy: [{ status: 'asc' }, { declaredAt: 'desc' }],
      take: f.take ?? 25,
      skip: f.skip ?? 0,
    }),
    prisma.registrationPayment.count({ where }),
  ]);

  return {
    rows: rows.map((p) => ({
      ...p,
      amountKes: p.amountKes ? Number(p.amountKes) : null,
      approveCount: p.approvals.filter((a) => a.decision === 'APPROVE').length,
    })),
    total,
    threshold: PAYMENT_APPROVAL_THRESHOLD,
  };
}

export async function getPaymentStats(ctx: Ctx) {
  requireCapability(ctx, 'payment.read');
  const rows = await prisma.registrationPayment.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amountKes: true },
  });
  return rows.map((r) => ({
    status: r.status,
    count: r._count._all,
    totalKes: r._sum.amountKes ? Number(r._sum.amountKes) : 0,
  }));
}
