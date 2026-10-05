import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

/**
 * The subject's own view.
 *
 * Every function here is scoped with `:own` — a person can read and act
 * on their record and nothing else. The capability check is the same
 * machinery staff go through; there is no separate "user" path that
 * could drift out of step.
 */

export async function getMyRecord(ctx: Ctx) {
  if (!ctx.partyId) return null;
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });

  return prisma.party.findUnique({
    where: { id: ctx.partyId, deletedAt: null },
    include: {
      person: true,
      enterprises: true,
      attestations: { where: { revokedAt: null }, include: { issuer: true }, orderBy: { issuedAt: 'desc' } },
      memberships: {
        where: { exitedAt: null },
        include: { org: { include: { party: true, _count: { select: { members: true } } } } },
      },
      documents: { where: { deletedAt: null }, orderBy: { uploadedAt: 'desc' } },
      registration: { include: { payment: { include: { approvals: true } } } },
      accounts: true,
      esoqoPaymentId: true,
    },
  });
}

/** Derived, never stored — same mechanism as group treasury (getGroupBalance
 *  in dal/treasury.ts), pointed at the caller's own WALLET account instead
 *  of an org's GROUP_SAVINGS account. No membership check: it's their own
 *  money, `entity.read:own` is the whole gate. */
export async function getWalletBalance(ctx: Ctx): Promise<number> {
  if (!ctx.partyId) return 0;
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });

  const account = await prisma.account.findFirst({ where: { partyId: ctx.partyId, kind: 'WALLET' } });
  if (!account) return 0;
  const sum = await prisma.posting.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
}

/** The number a wallet withdrawal will always be sent to — read-only
 *  display so the withdrawal UI can show it before the person commits to
 *  an amount, without pulling in getMyRecord's much heavier include set
 *  just for one field. */
export async function getMyMsisdn(ctx: Ctx): Promise<string | null> {
  if (!ctx.partyId) return null;
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });
  const person = await prisma.person.findUnique({ where: { partyId: ctx.partyId }, select: { msisdn: true } });
  return person?.msisdn ?? null;
}

export type WalletActivityKind = 'TOPUP' | 'WITHDRAWAL' | 'TRANSFER_SENT' | 'TRANSFER_RECEIVED';

export interface WalletActivityItem {
  id: string;
  kind: WalletActivityKind;
  amountKes: number;
  feeKes: number;
  /** PENDING/CONFIRMED/FAILED for a top-up or withdrawal (an M-Pesa leg
   *  really is in flight); always 'CONFIRMED' for a transfer, which
   *  settles synchronously — see createEsoqoTransfer. */
  status: string;
  /** Who the money moved with — the M-Pesa number for a top-up/withdrawal,
   *  the counterparty's name for a transfer. */
  counterparty: string;
  note: string | null;
  /** The M-Pesa receipt/transaction code — what someone would quote to
   *  support or reconcile against their M-Pesa statement. Null for a
   *  transfer (settles synchronously via journal entry, no M-Pesa leg to
   *  reference) or a top-up/withdrawal not yet CONFIRMED. */
  reference: string | null;
  createdAt: Date;
}

/** The caller's own money-movement history — top-ups, withdrawals, and
 *  transfers sent or received — merged and sorted newest-first.
 *
 *  No single table holds this (WalletTopUp, WalletWithdrawal and
 *  EsoqoTransfer are separate models, each with the shape its own
 *  settlement mechanics need — see each model's own doc comment), so this
 *  fetches `take` from each and merges in memory rather than requiring a
 *  denormalised activity-log table just for display. A wallet's history
 *  is bounded by how often one person moves money, not by scale, so this
 *  is cheap in practice. */
export async function getWalletActivity(ctx: Ctx, take = 20): Promise<WalletActivityItem[]> {
  if (!ctx.partyId) return [];
  requireCapability(ctx, 'entity.read', { partyId: ctx.partyId });

  const [topups, withdrawals, sent, received] = await Promise.all([
    prisma.walletTopUp.findMany({ where: { partyId: ctx.partyId }, orderBy: { createdAt: 'desc' }, take }),
    prisma.walletWithdrawal.findMany({ where: { partyId: ctx.partyId }, orderBy: { createdAt: 'desc' }, take }),
    prisma.esoqoTransfer.findMany({ where: { senderPartyId: ctx.partyId }, orderBy: { createdAt: 'desc' }, take }),
    prisma.esoqoTransfer.findMany({ where: { receiverPartyId: ctx.partyId }, orderBy: { createdAt: 'desc' }, take }),
  ]);

  const senderNames = received.length
    ? await prisma.party.findMany({
        where: { id: { in: received.map((t) => t.senderPartyId) } },
        select: { id: true, person: { select: { knownAs: true, officialName: true } }, organisation: { select: { knownAs: true, officialName: true } } },
      })
    : [];
  const senderName = (partyId: string): string => {
    const row = senderNames.find((p) => p.id === partyId);
    return row?.person?.knownAs || row?.person?.officialName
      || row?.organisation?.knownAs || row?.organisation?.officialName || 'An Esoqo user';
  };

  const items: WalletActivityItem[] = [
    ...topups.map((t) => ({
      id: t.id, kind: 'TOPUP' as const, amountKes: Number(t.amountKes), feeKes: 0,
      status: t.status, counterparty: t.msisdn, note: null,
      reference: t.mpesaReceiptCode, createdAt: t.createdAt,
    })),
    ...withdrawals.map((w) => ({
      id: w.id, kind: 'WITHDRAWAL' as const, amountKes: Number(w.amountKes), feeKes: Number(w.feeKes),
      status: w.status, counterparty: w.msisdn, note: null,
      reference: w.mpesaTransactionId, createdAt: w.createdAt,
    })),
    ...sent.map((t) => ({
      id: t.id, kind: 'TRANSFER_SENT' as const, amountKes: Number(t.amountKes), feeKes: Number(t.feeKes),
      status: 'CONFIRMED', counterparty: t.receiverName, note: t.note,
      reference: null, createdAt: t.createdAt,
    })),
    ...received.map((t) => ({
      id: t.id, kind: 'TRANSFER_RECEIVED' as const, amountKes: Number(t.amountKes), feeKes: 0,
      status: 'CONFIRMED', counterparty: senderName(t.senderPartyId), note: t.note,
      reference: null, createdAt: t.createdAt,
    })),
  ];

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

export async function listMyConsents(ctx: Ctx) {
  if (!ctx.partyId) return [];
  requireCapability(ctx, 'consent.read', { partyId: ctx.partyId });

  return prisma.consentGrant.findMany({
    where: { subjectId: ctx.partyId },
    include: { grantee: true, _count: { select: { accesses: true } } },
    orderBy: [{ revokedAt: 'asc' }, { grantedAt: 'desc' }],
  });
}

/**
 * Revocation. Deliberately never blocked and never questioned — the
 * Data Protection Act makes this a right, not a request, and the design
 * commitment on the public site says it takes three presses on USSD.
 */
export async function revokeConsent(ctx: Ctx, grantId: string, channel = 'WEB') {
  if (!ctx.partyId) throw new Error('Not signed in');
  requireCapability(ctx, 'consent.write', { partyId: ctx.partyId });

  const grant = await prisma.consentGrant.findFirst({
    where: { id: grantId, subjectId: ctx.partyId },
  });
  if (!grant) throw new Error('That permission was not found');
  if (grant.revokedAt) return grant;

  const updated = await prisma.consentGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date(), revocationChannel: channel },
  });

  await recordAudit(ctx, {
    action: 'consent.revoked',
    targetType: 'consent',
    targetId: grantId,
    payload: { granteeId: grant.granteeId, purpose: grant.purpose, channel },
  });

  return updated;
}

/* ── display preferences ─────────────────────────────────── */

export interface DisplayPrefs {
  textSize?: '100' | '125' | '150' | '200';
  spacing?: 'normal' | 'relaxed' | 'loose';
  font?: 'system' | 'legible';
  contrast?: 'standard' | 'high';
  motion?: 'full' | 'reduced';
  language?: 'en' | 'sw';
}

const DEFAULTS: Required<DisplayPrefs> = {
  textSize: '100', spacing: 'normal', font: 'system',
  contrast: 'standard', motion: 'full', language: 'en',
};

export async function getDisplayPrefs(ctx: Ctx): Promise<Required<DisplayPrefs>> {
  if (!ctx.partyId) return DEFAULTS;
  const person = await prisma.person.findUnique({
    where: { partyId: ctx.partyId }, select: { displayPrefs: true },
  });
  return { ...DEFAULTS, ...((person?.displayPrefs as DisplayPrefs) ?? {}) };
}

export async function setDisplayPrefs(ctx: Ctx, prefs: DisplayPrefs) {
  if (!ctx.partyId) throw new Error('Not signed in');
  requireCapability(ctx, 'entity.write', { partyId: ctx.partyId });

  const current = await getDisplayPrefs(ctx);
  const merged = { ...current, ...prefs };

  await prisma.person.update({
    where: { partyId: ctx.partyId }, data: { displayPrefs: merged },
  });
  await recordAudit(ctx, {
    action: 'preferences.updated', targetType: 'party', targetId: ctx.partyId,
    payload: { changed: Object.keys(prefs) },
  });
  return merged;
}
