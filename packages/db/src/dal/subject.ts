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
