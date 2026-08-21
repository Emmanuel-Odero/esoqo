import { prisma } from '../client';
import { recordAudit } from '../audit';
import { requireCapability, type Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';
import type { CampaignStatus } from '@prisma/client';

export class CampaignError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'SLUG_TAKEN') {
    super(msg);
    this.name = 'CampaignError';
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

export interface CreateCampaignInput {
  title: string;
  summary: string;
  body?: string;
  goalKes: number;
  coverUrl?: string;
  coverStorageKey?: string;
  endsAt?: Date;
}

/**
 * Opens a campaign and its own ledger Account in one step — kept apart
 * from the org's GROUP_SAVINGS account, same reasoning as
 * AccountKind.CAMPAIGN_RECEIVED's schema comment: donor money to a named
 * campaign must never look like, or mix with, table-banking savings.
 */
export async function createCampaign(ctx: Ctx, pageId: string, input: CreateCampaignInput) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const title = input.title.trim();
  if (!title) throw new Error('Give the campaign a title');
  if (!(input.goalKes > 0)) throw new Error('Set a goal above zero');

  const base = slugify(title);
  let slug = base || 'campaign';
  for (let n = 1; await prisma.campaign.findUnique({ where: { pageId_slug: { pageId, slug } } }); n++) {
    slug = `${base}-${n}`;
  }

  const campaign = await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({ data: { kind: 'CAMPAIGN_RECEIVED', currency: 'KES' } });
    return tx.campaign.create({
      data: {
        pageId, title, slug, summary: input.summary.trim(), body: input.body?.trim() || null,
        goalKes: input.goalKes, coverUrl: input.coverUrl || null, coverStorageKey: input.coverStorageKey || null,
        endsAt: input.endsAt ?? null, status: 'ACTIVE', startsAt: new Date(), accountId: account.id,
      },
    });
  });

  await recordAudit(ctx, {
    action: 'campaign.created', targetType: 'campaign', targetId: campaign.id,
    payload: { pageId, title, goalKes: input.goalKes },
  });
  return campaign;
}

export async function listCampaigns(pageId: string, status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED') {
  return prisma.campaign.findMany({
    where: { pageId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

/** Single-campaign lookup for the dashboard's edit screen — scoped to
 *  `pageId` so a campaign id from another org's page can't be loaded. */
export async function getCampaign(ctx: Ctx, pageId: string, campaignId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.campaign.findFirst({ where: { id: campaignId, pageId } });
}

export interface UpdateCampaignInput {
  title?: string;
  summary?: string;
  body?: string;
  goalKes?: number;
  coverUrl?: string;
  coverStorageKey?: string;
  endsAt?: Date | null;
  status?: CampaignStatus;
}

/** Mirrors updateJamiiPage's shape (requirePageAccess + recordAudit) — the
 *  title/slug relationship set up in createCampaign is left alone here
 *  (no slug regeneration on rename), so an already-shared campaign link
 *  never breaks under a later edit. */
export async function updateCampaign(ctx: Ctx, pageId: string, campaignId: string, patch: UpdateCampaignInput) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const existing = await prisma.campaign.findFirst({ where: { id: campaignId, pageId } });
  if (!existing) throw new CampaignError('Campaign not found', 'NOT_FOUND');
  if (patch.title !== undefined && !patch.title.trim()) throw new Error('Give the campaign a title');
  if (patch.goalKes !== undefined && !(patch.goalKes > 0)) throw new Error('Set a goal above zero');

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() || null } : {}),
      ...(patch.goalKes !== undefined ? { goalKes: patch.goalKes } : {}),
      ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl || null } : {}),
      ...(patch.coverStorageKey !== undefined ? { coverStorageKey: patch.coverStorageKey || null } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    },
  });
  await recordAudit(ctx, { action: 'campaign.updated', targetType: 'campaign', targetId: campaignId });
  return campaign;
}

/** Public campaign lookup, scoped to its page's slug for the /o/[slug]/c/[slug] route. */
export async function getCampaignBySlug(pageSlug: string, campaignSlug: string) {
  const page = await prisma.jamiiPage.findFirst({ where: { slug: pageSlug, status: 'PUBLISHED' } });
  if (!page) return null;
  return prisma.campaign.findFirst({
    where: { pageId: page.organisationId, slug: campaignSlug },
    include: {
      page: {
        include: {
          organisation: {
            include: {
              party: {
                include: { attestations: { where: { claimType: 'ORG_PAGE_VERIFIED', revokedAt: null }, take: 1 } },
              },
            },
          },
          // See PUBLIC_PAGE_INCLUDE in jamii-page.ts — same ACTIVE-only
          // scoping, needed here too so orgExternalUrl() works on the
          // campaign page (OrgTopNav's websiteUrl prop).
          domain: { where: { status: 'ACTIVE', removedAt: null } },
        },
      },
      updates: { orderBy: { postedAt: 'desc' } },
    },
  });
}

/**
 * Raised amount + supporter count, derived — never stored — from the
 * campaign's Postings, the same rule the commerce ledger follows.
 */
export async function getCampaignStats(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign?.accountId) return { raisedKes: 0, supporters: 0 };

  const [postings, supporters] = await Promise.all([
    prisma.posting.aggregate({ where: { accountId: campaign.accountId }, _sum: { amount: true } }),
    prisma.donation.count({ where: { campaignId, status: 'CONFIRMED' } }),
  ]);
  return { raisedKes: Number(postings._sum.amount ?? 0), supporters };
}

/** Verifies `campaignId` actually belongs to `pageId` before any write —
 *  requirePageAccess alone only proves the caller may manage *a* page,
 *  not that this particular campaign is theirs; without this check a
 *  CONTRIBUTOR on one org's page could post/delete updates on any
 *  other org's campaign by guessing its id. */
async function assertOwnsCampaign(pageId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, pageId }, select: { id: true } });
  if (!campaign) throw new CampaignError('Campaign not found', 'NOT_FOUND');
}

export async function addCampaignUpdate(ctx: Ctx, pageId: string, campaignId: string, title: string, body: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  await assertOwnsCampaign(pageId, campaignId);
  const update = await prisma.campaignUpdate.create({ data: { campaignId, title: title.trim(), body: body.trim() } });
  await recordAudit(ctx, { action: 'campaign.update_posted', targetType: 'campaign', targetId: campaignId });
  return update;
}

/** The dashboard edit screen's own updates list — getCampaignBySlug's
 *  public lookup already includes `updates`, but that one is scoped to
 *  a PUBLISHED page; this is the owner-facing equivalent. */
export async function listCampaignUpdatesForOwner(ctx: Ctx, pageId: string, campaignId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  await assertOwnsCampaign(pageId, campaignId);
  return prisma.campaignUpdate.findMany({ where: { campaignId }, orderBy: { postedAt: 'desc' } });
}

export async function deleteCampaignUpdate(ctx: Ctx, pageId: string, campaignId: string, updateId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  await assertOwnsCampaign(pageId, campaignId);
  await prisma.campaignUpdate.delete({ where: { id: updateId, campaignId } });
  await recordAudit(ctx, { action: 'campaign.update_deleted', targetType: 'campaign', targetId: campaignId });
}

/** Recent donations for the campaign's public "supporters" wall. */
export async function listRecentDonations(campaignId: string, take = 12) {
  return prisma.donation.findMany({
    where: { campaignId, status: 'CONFIRMED' },
    orderBy: { confirmedAt: 'desc' },
    take,
  });
}

/* ═══════════════════════════ staff / admin ═══════════════════════════ */

export interface ListCampaignsForStaffFilter {
  status?: CampaignStatus;
  search?: string;
  take?: number;
  skip?: number;
}

/** Every campaign, across every page — the admin app's Our Jamii >
 *  Campaigns screen. listCampaigns (above) is scoped to one page. */
export async function listCampaignsForStaff(ctx: Ctx, f: ListCampaignsForStaffFilter = {}) {
  requireCapability(ctx, 'jamii-campaign.read');

  const where = {
    status: f.status,
    ...(f.search
      ? {
          OR: [
            { title: { contains: f.search, mode: 'insensitive' as const } },
            { page: { organisation: { officialName: { contains: f.search, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: {
        page: { include: { organisation: { select: { officialName: true } } } },
        _count: { select: { donations: { where: { status: 'CONFIRMED' } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.campaign.count({ where }),
  ]);
  return { rows, total };
}

export async function getCampaignCountsForStaff(ctx: Ctx) {
  requireCapability(ctx, 'jamii-campaign.read');
  const [draft, active, completed, cancelled] = await Promise.all([
    prisma.campaign.count({ where: { status: 'DRAFT' } }),
    prisma.campaign.count({ where: { status: 'ACTIVE' } }),
    prisma.campaign.count({ where: { status: 'COMPLETED' } }),
    prisma.campaign.count({ where: { status: 'CANCELLED' } }),
  ]);
  return { draft, active, completed, cancelled };
}

/** Staff moderation — pull a campaign that looks fraudulent or is
 *  misrepresenting what it raises for, or reinstate one. */
export async function moderateCampaign(
  ctx: Ctx, campaignId: string, status: 'ACTIVE' | 'CANCELLED', reason: string,
) {
  requireCapability(ctx, 'jamii-campaign.moderate');
  if (!reason.trim()) throw new Error('A reason is required');

  const campaign = await prisma.campaign.update({ where: { id: campaignId }, data: { status } });
  await recordAudit(ctx, {
    action: status === 'CANCELLED' ? 'campaign.staff_cancelled' : 'campaign.reinstated',
    targetType: 'campaign',
    targetId: campaignId,
    payload: { reason },
  });
  return campaign;
}
