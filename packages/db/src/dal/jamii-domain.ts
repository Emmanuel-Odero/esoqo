import { randomBytes } from 'node:crypto';
import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { requirePageAccess } from './jamii-page';
import { jamiiDomainHostnameSchema, JAMII_RESERVED_DOMAIN_SUFFIXES } from '@esoko/domain';
import type { JamiiDomainStatus, Prisma } from '@prisma/client';

/**
 * Custom domains for Our Jamii pages — "link your minisite to your own
 * domain" without a second product: a verified JamiiDomain just changes
 * how a JamiiPage is *reached*, never what it is. See the schema file's
 * JamiiDomain header for the state machine, and
 * services/core/src/routes/jamii-domains.ts for the reconciler that
 * actually talks to Cloudflare and drives PENDING_DNS -> VERIFYING ->
 * ACTIVE/FAILED. Nothing in this file ever calls Cloudflare — the API
 * token that can do that lives only in the core plane, never here or in
 * apps/jamii's env, because it's powerful enough to point arbitrary
 * hostnames at us.
 */

export class JamiiDomainError extends Error {
  constructor(
    msg: string,
    public readonly code: 'NOT_FOUND' | 'DOMAIN_TAKEN' | 'ALREADY_LINKED' | 'REMOVAL_PENDING' | 'RATE_LIMITED' | 'INVALID',
  ) {
    super(msg);
    this.name = 'JamiiDomainError';
  }
}

/** A request/re-request too soon after the last one — slows down
 *  automated hostname-squatting attempts without needing a real
 *  rate-limit store for what is, in practice, a low-volume action. */
const REQUEST_COOLDOWN_MS = 30_000;

/** How long an unverified claim on a hostname can sit before a
 *  *different* page is allowed to reclaim that hostname. Long enough
 *  for a real group to get their DNS right, short enough that a
 *  domain nobody ever finished verifying doesn't squat on the name
 *  forever and block its real owner. */
const RECLAIM_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function normaliseHostname(raw: string): string {
  const parsed = jamiiDomainHostnameSchema.safeParse(raw);
  if (!parsed.success) throw new JamiiDomainError(parsed.error.issues[0]?.message ?? 'Enter a valid domain', 'INVALID');
  const hostname = parsed.data;
  if (JAMII_RESERVED_DOMAIN_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))) {
    throw new JamiiDomainError('That domain is reserved and can’t be linked', 'INVALID');
  }
  return hostname;
}

/**
 * Requests (or re-targets, while still unverified) the one custom
 * domain a page may have. Page ADMIN only — same bar as publishing the
 * page itself, since this changes where donors/visitors land.
 */
export async function requestJamiiDomain(ctx: Ctx, pageId: string, hostnameInput: string) {
  await requirePageAccess(ctx, pageId, 'ADMIN');
  const hostname = normaliseHostname(hostnameInput);

  const result = await prisma.$transaction(async (tx) => {
    const existingForPage = await tx.jamiiDomain.findUnique({ where: { pageId } });

    if (existingForPage) {
      if (existingForPage.removedAt) {
        throw new JamiiDomainError('This page’s previous domain is still being unlinked — try again shortly', 'REMOVAL_PENDING');
      }
      if (existingForPage.status === 'ACTIVE' || existingForPage.status === 'VERIFYING') {
        throw new JamiiDomainError('This page already has a domain — remove it before linking another', 'ALREADY_LINKED');
      }
      if (existingForPage.status === 'SUSPENDED') {
        throw new JamiiDomainError('This page’s domain was suspended — contact Esoko support', 'ALREADY_LINKED');
      }
      const sinceLastRequest = Date.now() - existingForPage.updatedAt.getTime();
      if (existingForPage.hostname === hostname && sinceLastRequest < REQUEST_COOLDOWN_MS) {
        throw new JamiiDomainError('Give it a moment before requesting again', 'RATE_LIMITED');
      }
      // PENDING_DNS or FAILED, re-targeting or retrying — reuse the row
      // rather than fighting the @unique(hostname) constraint against
      // itself when the hostname is unchanged.
      if (existingForPage.hostname !== hostname) {
        await assertHostnameClaimable(tx, hostname, pageId);
      }
      return tx.jamiiDomain.update({
        where: { pageId },
        data: {
          hostname,
          status: 'PENDING_DNS',
          verificationToken: randomBytes(16).toString('hex'),
          cfHostnameId: null,
          cfStatus: null,
          failureReason: null,
          lastCheckedAt: null,
          activatedAt: null,
          requestedByPartyId: ctx.partyId!,
        },
      });
    }

    await assertHostnameClaimable(tx, hostname, pageId);
    return tx.jamiiDomain.create({
      data: {
        pageId,
        hostname,
        verificationToken: randomBytes(16).toString('hex'),
        requestedByPartyId: ctx.partyId!,
      },
    });
  });

  await recordAudit(ctx, {
    action: 'jamii_domain.requested',
    targetType: 'jamii_page',
    targetId: pageId,
    payload: { hostname },
  });
  return result;
}

/**
 * Anti-squatting check: a hostname already claimed by someone else is
 * only reclaimable if their claim never got past an unverified state
 * and has gone stale — see RECLAIM_STALE_AFTER_MS. An ACTIVE, VERIFYING
 * or recently-requested claim by another page blocks the request
 * outright; we deliberately don't say who holds it.
 */
async function assertHostnameClaimable(
  tx: Prisma.TransactionClient,
  hostname: string,
  pageId: string,
) {
  const holder = await tx.jamiiDomain.findUnique({ where: { hostname } });
  if (!holder || holder.pageId === pageId) return;

  const staleUnverified =
    (holder.status === 'PENDING_DNS' || holder.status === 'FAILED') &&
    Date.now() - holder.updatedAt.getTime() > RECLAIM_STALE_AFTER_MS;

  if (!staleUnverified) {
    throw new JamiiDomainError('This domain is already linked to another page', 'DOMAIN_TAKEN');
  }
  // Reclaim: the stale claimant never proved control of the domain, so
  // it never went live — safe to free the hostname for the new claim.
  await tx.jamiiDomain.delete({ where: { id: holder.id } });
}

/** For the dashboard's Domain settings panel — page team read. */
export async function getJamiiDomain(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiDomain.findUnique({ where: { pageId } });
}

/**
 * Self-serve removal. Doesn't delete the row outright — flips
 * `removedAt` so resolveJamiiDomain() stops routing traffic for it
 * immediately, and leaves the Cloudflare hostname teardown (and the
 * row's eventual deletion, freeing the hostname for reuse) to the
 * reconciler, which is the only thing that holds the Cloudflare API
 * token.
 */
export async function removeJamiiDomain(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'ADMIN');
  const domain = await prisma.jamiiDomain.findUnique({ where: { pageId } });
  if (!domain || domain.removedAt) throw new JamiiDomainError('No domain to remove', 'NOT_FOUND');

  const updated = await prisma.jamiiDomain.update({
    where: { pageId },
    data: { removedAt: new Date() },
  });
  await recordAudit(ctx, {
    action: 'jamii_domain.removed',
    targetType: 'jamii_page',
    targetId: pageId,
    payload: { hostname: domain.hostname },
  });
  return updated;
}

/**
 * Public resolver — the ONLY thing apps/jamii's middleware calls. No
 * Ctx, no capability, deliberately: this runs on every request to an
 * unrecognised Host header, before anyone has a session. Only ever
 * returns a hostname that is live *right now* — ACTIVE and not in the
 * middle of being removed — and returns nothing at all rather than a
 * reason for a miss, so a probe can't distinguish "never claimed" from
 * "pending" from "suspended".
 */
export async function resolveJamiiDomain(hostname: string): Promise<{ pageId: string; slug: string } | null> {
  const domain = await prisma.jamiiDomain.findFirst({
    where: { hostname: hostname.toLowerCase(), status: 'ACTIVE', removedAt: null },
    include: { page: { select: { slug: true } } },
  });
  if (!domain) return null;
  return { pageId: domain.pageId, slug: domain.page.slug };
}

/* ═══════════════════════════ staff / admin ═══════════════════════════
 *
 * Mirrors jamii-page.ts's staff section: platform-wide visibility and
 * a kill-switch, independent of page team membership.
 */

export async function listJamiiDomainsForStaff(ctx: Ctx, f: { status?: JamiiDomainStatus; take?: number; skip?: number } = {}) {
  requireCapability(ctx, 'jamii-domain.moderate');
  const where = { status: f.status, removedAt: null };
  const [rows, total] = await Promise.all([
    prisma.jamiiDomain.findMany({
      where,
      include: { page: { select: { slug: true, organisation: { select: { officialName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.jamiiDomain.count({ where }),
  ]);
  return { rows, total };
}

export async function suspendJamiiDomain(ctx: Ctx, domainId: string, reason: string) {
  requireCapability(ctx, 'jamii-domain.moderate');
  if (!reason.trim()) throw new Error('A reason is required');
  const domain = await prisma.jamiiDomain.update({ where: { id: domainId }, data: { status: 'SUSPENDED' } });
  await recordAudit(ctx, {
    action: 'jamii_domain.suspended', targetType: 'jamii_page', targetId: domain.pageId, payload: { reason, hostname: domain.hostname },
  });
  return domain;
}

export async function reinstateJamiiDomain(ctx: Ctx, domainId: string) {
  requireCapability(ctx, 'jamii-domain.moderate');
  const current = await prisma.jamiiDomain.findUniqueOrThrow({ where: { id: domainId } });
  // Reinstating doesn't assume the cert/CF hostname is still good — put
  // it back through verification rather than straight to ACTIVE.
  const domain = await prisma.jamiiDomain.update({
    where: { id: domainId },
    data: { status: current.cfHostnameId ? 'VERIFYING' : 'PENDING_DNS' },
  });
  await recordAudit(ctx, { action: 'jamii_domain.reinstated', targetType: 'jamii_page', targetId: domain.pageId, payload: { hostname: domain.hostname } });
  return domain;
}

/** Staff force-removal — same effect as the page owner's own
 *  removeJamiiDomain, for abuse/impersonation takedowns. */
export async function staffRemoveJamiiDomain(ctx: Ctx, domainId: string, reason: string) {
  requireCapability(ctx, 'jamii-domain.moderate');
  if (!reason.trim()) throw new Error('A reason is required');
  const domain = await prisma.jamiiDomain.update({ where: { id: domainId }, data: { removedAt: new Date() } });
  await recordAudit(ctx, {
    action: 'jamii_domain.staff_removed', targetType: 'jamii_page', targetId: domain.pageId, payload: { reason, hostname: domain.hostname },
  });
  return domain;
}

/* ═══════════════════════════ reconciler-internal ═══════════════════════════
 *
 * Called only from services/core's reconcile route, authenticated by
 * its own HMAC service secret — never exposed as a Server Action or an
 * admin/dashboard capability. No Ctx: the caller isn't a person, it's
 * the reconciler acting with the one privileged secret that can talk to
 * Cloudflare.
 */

export async function listDomainsNeedingReconciliation() {
  return prisma.jamiiDomain.findMany({
    where: {
      OR: [
        { status: 'PENDING_DNS' },
        { status: 'VERIFYING' },
        { removedAt: { not: null }, cfHostnameId: { not: null } },
      ],
    },
    take: 200,
  });
}

export async function markDomainVerifying(domainId: string, cfHostnameId: string, cfStatus: string) {
  return prisma.jamiiDomain.update({
    where: { id: domainId },
    data: { status: 'VERIFYING', cfHostnameId, cfStatus, lastCheckedAt: new Date() },
  });
}

export async function markDomainActive(domainId: string, cfStatus: string) {
  return prisma.jamiiDomain.update({
    where: { id: domainId },
    data: { status: 'ACTIVE', cfStatus, activatedAt: new Date(), lastCheckedAt: new Date(), failureReason: null },
  });
}

export async function markDomainFailed(domainId: string, reason: string, cfStatus?: string) {
  return prisma.jamiiDomain.update({
    where: { id: domainId },
    data: { status: 'FAILED', failureReason: reason, cfStatus, lastCheckedAt: new Date() },
  });
}

export async function touchDomainCheck(domainId: string, cfStatus?: string) {
  return prisma.jamiiDomain.update({ where: { id: domainId }, data: { lastCheckedAt: new Date(), cfStatus } });
}

/** The reconciler's last step for a removed domain, once it has
 *  confirmed the Cloudflare hostname is torn down — frees the hostname
 *  string for anyone (including the same page) to claim again. */
export async function finaliseRemovedDomain(domainId: string) {
  await prisma.jamiiDomain.delete({ where: { id: domainId } });
}
