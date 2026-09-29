import { extractEsoqoId, normaliseMsisdn } from '@esoqo/domain';
import type { Prisma, PartyKind } from '@prisma/client';
import { prisma } from '../client';
import { requireCapability, anonCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { getWalletBalance } from './subject';
import { findPayableBusinesses } from './business-payment';
import { walletAccountId, businessRevenueAccountId } from './wallet-shared';

/**
 * Esoqo-to-Esoqo transfer by handle — a person paying another person, or a
 * person paying a business straight from their WALLET balance, with no
 * M-Pesa leg at all. This is the actual differentiator over M-Pesa's own
 * P2P send: money moving inside Esoqo's own ledger costs nothing, so
 * nothing is charged for it (see dal/fees.ts — TransactionFeeKind has no
 * INTERNAL_TRANSFER kind, and this file never calls feeForAmount).
 *
 * Settles synchronously: unlike WalletTopUp/WalletWithdrawal there is no
 * external system to wait on, so a transfer is created and its ledger
 * entry posted in one transaction — there is no PENDING state at the
 * model level.
 */

export class EsoqoTransferError extends Error {
  code: 'AMOUNT_INVALID' | 'NOT_FOUND' | 'CANNOT_PAY_SELF' | 'INSUFFICIENT_BALANCE';
  constructor(message: string, code: EsoqoTransferError['code']) {
    super(message);
    this.code = code;
  }
}

export interface TransferTarget {
  partyId: string;
  esoqoId: string;
  name: string;
  kind: PartyKind;
}

const targetSelect = {
  id: true,
  kind: true,
  esoqoPaymentId: { select: { code: true, suspendedAt: true } },
  person: { select: { knownAs: true, officialName: true } },
  organisation: { select: { knownAs: true, officialName: true } },
} satisfies Prisma.PartySelect;

type TargetRow = Prisma.PartyGetPayload<{ select: typeof targetSelect }>;

function toTarget(row: TargetRow | null): TransferTarget | null {
  if (!row?.esoqoPaymentId || row.esoqoPaymentId.suspendedAt) return null;
  const name = row.kind === 'PERSON'
    ? (row.person?.knownAs || row.person?.officialName || 'Esoqo user')
    : (row.organisation?.knownAs || row.organisation?.officialName || 'Business');
  return { partyId: row.id, esoqoId: row.esoqoPaymentId.code, name, kind: row.kind };
}

/**
 * Resolves whatever a sender typed/scanned to a payable party — person or
 * business. Reuses findPayableBusinesses (dal/business-payment.ts) for the
 * business half rather than re-implementing its msisdn/email/name lookups;
 * the only thing new here is that a person can be a payee too, which
 * findPayableBusinesses deliberately excludes (it hard-filters to
 * ORGANISATION for the public /pay page's own reasons).
 *
 * An Esoqo ID resolves against ANY party kind directly — a handle is a
 * handle regardless of who holds it. An msisdn or email tries the person
 * it names first (paying "the person at this number"), then falls back to
 * a business lookup (paying "the business registered at this number"),
 * since both are legitimate readings of the same input and a person
 * match is the more specific one. A bare name is business-only, same as
 * the public /pay page — there is no directory of people to search by
 * name, and there shouldn't be.
 */
export async function resolveTransferTarget(identifier: string): Promise<TransferTarget | null> {
  const raw = identifier.trim();
  if (!raw) return null;

  const esoqoId = extractEsoqoId(raw);
  if (esoqoId) {
    const row = await prisma.party.findFirst({
      where: { deletedAt: null, esoqoPaymentId: { code: esoqoId } },
      select: targetSelect,
    });
    return toTarget(row);
  }

  const msisdn = normaliseMsisdn(raw);
  if (msisdn) {
    const row = await prisma.party.findFirst({
      where: { deletedAt: null, kind: 'PERSON', person: { msisdn } },
      select: targetSelect,
    });
    const person = toTarget(row);
    if (person) return person;
    const businesses = await findPayableBusinesses(anonCtx(), raw, 1);
    return businesses[0] ? { partyId: businesses[0].partyId, esoqoId: businesses[0].esoqoId, name: businesses[0].name, kind: 'ORGANISATION' } : null;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    const row = await prisma.party.findFirst({
      where: { deletedAt: null, kind: 'PERSON', person: { email: raw } },
      select: targetSelect,
    });
    const person = toTarget(row);
    if (person) return person;
    const businesses = await findPayableBusinesses(anonCtx(), raw, 1);
    return businesses[0] ? { partyId: businesses[0].partyId, esoqoId: businesses[0].esoqoId, name: businesses[0].name, kind: 'ORGANISATION' } : null;
  }

  const businesses = await findPayableBusinesses(anonCtx(), raw, 1);
  return businesses[0] ? { partyId: businesses[0].partyId, esoqoId: businesses[0].esoqoId, name: businesses[0].name, kind: 'ORGANISATION' } : null;
}

export interface CreateEsoqoTransferInput {
  toIdentifier: string;
  amountKes: number;
  note?: string | null;
}

const NOTE_MAX = 140;

export interface EsoqoTransferNotifyInfo {
  senderPartyId: string;
  senderName: string;
  senderMsisdn: string | null;
  receiverPartyId: string;
  receiverName: string;
  receiverKind: PartyKind;
  /** Who to text on the receiving end — one number for a person, up to
   *  five office-holders' numbers for a business. Empty is normal, not an
   *  error: a receiver may have no number on file, same caveat
   *  BusinessPayment's businessMsisdns already carries. */
  receiverMsisdns: string[];
  amountKes: number;
  note: string | null;
}

async function receiverMsisdnsFor(target: TransferTarget): Promise<string[]> {
  if (target.kind === 'PERSON') {
    const person = await prisma.person.findUnique({ where: { partyId: target.partyId }, select: { msisdn: true } });
    return person?.msisdn ? [person.msisdn] : [];
  }
  const members = await prisma.membership.findMany({
    where: { orgId: target.partyId, exitedAt: null, status: 'ACTIVE', person: { person: { msisdn: { not: null } } } },
    select: { person: { select: { person: { select: { msisdn: true } } } } },
    take: 5,
  });
  return [...new Set(members.map((m) => m.person?.person?.msisdn).filter((n): n is string => Boolean(n)))];
}

export async function createEsoqoTransfer(
  ctx: Ctx, input: CreateEsoqoTransferInput,
): Promise<{ transfer: Awaited<ReturnType<typeof prisma.esoqoTransfer.create>>; notify: EsoqoTransferNotifyInfo }> {
  if (!ctx.partyId) throw new EsoqoTransferError('Sign in required', 'NOT_FOUND');
  requireCapability(ctx, 'wallet.transfer', { partyId: ctx.partyId });

  const amount = Number(input.amountKes);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new EsoqoTransferError('Enter an amount above zero', 'AMOUNT_INVALID');
  }

  const target = await resolveTransferTarget(input.toIdentifier);
  if (!target) {
    throw new EsoqoTransferError("We couldn't find anyone to pay with that handle, number or email", 'NOT_FOUND');
  }
  if (target.partyId === ctx.partyId) {
    throw new EsoqoTransferError("You can't send money to yourself", 'CANNOT_PAY_SELF');
  }

  const balance = await getWalletBalance(ctx);
  if (amount > balance) {
    throw new EsoqoTransferError(
      `Your wallet balance is KES ${balance.toLocaleString('en-KE')} — you can't send more than that`,
      'INSUFFICIENT_BALANCE',
    );
  }

  const sender = await prisma.party.findUnique({
    where: { id: ctx.partyId },
    select: { person: { select: { knownAs: true, officialName: true, msisdn: true } } },
  });
  const senderName = sender?.person?.knownAs || sender?.person?.officialName || 'An Esoqo user';
  const note = input.note?.trim().slice(0, NOTE_MAX) || null;

  const transfer = await prisma.$transaction(async (tx) => {
    const created = await tx.esoqoTransfer.create({
      data: {
        senderPartyId: ctx.partyId!,
        receiverPartyId: target.partyId,
        receiverEsoqoId: target.esoqoId,
        receiverName: target.name,
        amountKes: amount,
        feeKes: 0,
        note,
      },
    });

    const [senderAccount, receiverAccount] = await Promise.all([
      walletAccountId(tx, ctx.partyId!),
      target.kind === 'ORGANISATION' ? businessRevenueAccountId(tx, target.partyId) : walletAccountId(tx, target.partyId),
    ]);

    const entry = await tx.journalEntry.create({
      data: {
        reference: `ESOQO-TRANSFER-${created.id}`,
        description: `Transfer to ${target.name}`,
        postings: {
          create: [
            { accountId: senderAccount, amount: -amount },
            { accountId: receiverAccount, amount },
          ],
        },
      },
    });

    return tx.esoqoTransfer.update({ where: { id: created.id }, data: { journalEntryId: entry.id } });
  });

  await recordAudit(ctx, {
    action: 'wallet.transferred',
    targetType: 'esoqo_transfer',
    targetId: transfer.id,
    payload: { receiverPartyId: target.partyId, receiverEsoqoId: target.esoqoId, amountKes: amount },
  });

  const receiverMsisdns = await receiverMsisdnsFor(target);

  return {
    transfer,
    notify: {
      senderPartyId: ctx.partyId,
      senderName,
      senderMsisdn: sender?.person?.msisdn ?? null,
      receiverPartyId: target.partyId,
      receiverName: target.name,
      receiverKind: target.kind,
      receiverMsisdns,
      amountKes: amount,
      note,
    },
  };
}

/** One transfer, for the sender's own history/receipt view — same
 *  no-capability-beyond-ownership contract getBusinessPayment already
 *  follows, scoped here to sender-or-receiver instead of an unguessable
 *  id, since a transfer (unlike a public /pay payment) always has a
 *  signed-in party on both ends. */
export async function getMyTransfer(ctx: Ctx, transferId: string) {
  if (!ctx.partyId) return null;
  const transfer = await prisma.esoqoTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) return null;
  if (transfer.senderPartyId !== ctx.partyId && transfer.receiverPartyId !== ctx.partyId) return null;
  return transfer;
}

/** A party's own transfer history, sent and received, newest first. */
export async function listMyTransfers(ctx: Ctx, take = 20) {
  if (!ctx.partyId) return [];
  return prisma.esoqoTransfer.findMany({
    where: { OR: [{ senderPartyId: ctx.partyId }, { receiverPartyId: ctx.partyId }] },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
