import { prisma } from '../client';
import { AuthorisationError, requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { JamiiPageStatus, OrgKind } from '@prisma/client';

/**
 * Our Jamii — public mini-sites for community groups.
 *
 * A JamiiPage is 1:1 with an Organisation, which is 1:1 with a Party —
 * the same Party/Organisation every other part of the platform (admin's
 * Groups screen, the USSD/app join flow) already uses. There is no
 * separate "community org" identity here, deliberately: see the schema
 * file header on why a second Group table is the mistake this avoids.
 */

export class JamiiError extends Error {
  constructor(
    msg: string,
    public readonly code: 'NOT_FOUND' | 'SLUG_TAKEN' | 'FORBIDDEN',
  ) {
    super(msg);
    this.name = 'JamiiError';
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/**
 * Bespoke ownership check for a JamiiPage, the same shape as
 * assertOwnsStore in dal/store.ts — page access is granted per person
 * via JamiiTeamMember, not by a single owning Party, so it can't be
 * expressed as a `:own` capability qualifier the way store ownership
 * (Store -> Enterprise -> Party) can. Staff holding `party.write`
 * outright (support/CECF ops) may act on any page.
 */
export async function requirePageAccess(
  ctx: Ctx,
  pageId: string,
  minRole: 'ADMIN' | 'EDITOR' | 'CONTRIBUTOR' = 'CONTRIBUTOR',
) {
  const page = await prisma.jamiiPage.findUnique({ where: { organisationId: pageId } });
  if (!page) throw new JamiiError('Page not found', 'NOT_FOUND');

  if (ctx.actorType === 'STAFF' && ctx.capabilities.some((c) => c === '*' || c === 'party.write')) {
    return page;
  }
  if (!ctx.partyId) throw new AuthorisationError('jamii-page.manage', ctx);

  const membership = await prisma.jamiiTeamMember.findFirst({
    where: { pageId, personId: ctx.partyId, removedAt: null },
  });
  if (!membership) throw new AuthorisationError('jamii-page.manage', ctx);

  const order = { ADMIN: 3, EDITOR: 2, CONTRIBUTOR: 1 } as const;
  if (order[membership.role] < order[minRole]) throw new AuthorisationError('jamii-page.manage', ctx);

  return page;
}

export interface CreateJamiiPageInput {
  orgKind: OrgKind;
  officialName: string;
  county: string;
  ward?: string;
  registrationNo?: string;
  memberCount?: number;
  tagline?: string;
}

/**
 * Founds a new group and its page in one step — the "/start" wizard.
 * Self-serve, the same way the public join/registration funnel creates
 * a Party without needing `party.write` (that capability is for staff
 * editing someone else's record, not a person creating their own).
 * Requires only that the caller is a signed-in person.
 */
export async function createJamiiPage(ctx: Ctx, input: CreateJamiiPageInput) {
  if (!ctx.partyId) throw new Error('Sign in to start your organisation’s page');

  const officialName = input.officialName.trim();
  if (!officialName) throw new Error('An organisation name is required');
  if (!input.county) throw new Error('A county is required');

  const founder = await prisma.person.findUnique({ where: { partyId: ctx.partyId } });
  if (!founder) throw new Error('Only a registered person may start a page');

  const base = slugify(officialName);
  let slug = base || 'organisation';
  for (let n = 1; await prisma.jamiiPage.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`;
  }

  const orgParty = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        kind: 'ORGANISATION',
        county: input.county,
        ward: input.ward || null,
        organisation: {
          create: {
            kind: input.orgKind,
            officialName,
            registrationNo: input.registrationNo?.trim() || null,
            memberCount: input.memberCount ?? null,
          },
        },
        accounts: { create: [{ kind: 'GROUP_SAVINGS', currency: 'KES' }] },
      },
      include: { organisation: true },
    });

    await tx.jamiiPage.create({
      data: {
        organisationId: party.id,
        slug,
        status: 'DRAFT',
        tagline: input.tagline?.trim() || null,
      },
    });

    await tx.jamiiTeamMember.create({
      data: {
        pageId: party.id,
        personId: ctx.partyId!,
        inviteName: founder.knownAs || founder.officialName,
        inviteEmail: founder.email || `${founder.msisdn ?? 'founder'}@no-email.ourjamii.local`,
        role: 'ADMIN',
        acceptedAt: new Date(),
      },
    });

    return party;
  });

  await recordAudit(ctx, {
    action: 'jamii_page.created',
    targetType: 'jamii_page',
    targetId: orgParty.id,
    payload: { officialName, county: input.county, slug },
  });

  return { organisationId: orgParty.id, slug };
}

const PUBLIC_PAGE_INCLUDE = {
  organisation: {
    include: {
      party: {
        include: {
          attestations: { where: { claimType: 'ORG_PAGE_VERIFIED' as const, revokedAt: null }, take: 1 },
        },
      },
      members: { where: { exitedAt: null }, include: { person: { include: { person: true } } }, orderBy: { joinedAt: 'asc' as const } },
    },
  },
  photos: { orderBy: { position: 'asc' as const } },
  programs: { orderBy: { position: 'asc' as const } },
  posts: { where: { status: 'PUBLISHED' as const }, orderBy: { publishedAt: 'desc' as const } },
  campaigns: { orderBy: { createdAt: 'desc' as const } },
  // Only ever an ACTIVE domain is worth exposing publicly — a
  // PENDING_DNS/FAILED/SUSPENDED row would either not resolve yet or
  // shouldn't be advertised as "their site". See orgExternalUrl() in
  // apps/jamii/src/lib/org-external-url.ts, the one place that reads
  // this.
  domain: { where: { status: 'ACTIVE' as const, removedAt: null } },
};

/** Public page lookup. No capability — anyone may browse a published page. */
export async function getJamiiPageBySlug(slug: string) {
  return prisma.jamiiPage.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: PUBLIC_PAGE_INCLUDE,
  });
}

/** Same lookup, ignoring publish status — for the owner's dashboard/preview. */
export async function getJamiiPageForManagement(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId);
  return prisma.jamiiPage.findUnique({ where: { organisationId: pageId }, include: PUBLIC_PAGE_INCLUDE });
}

export interface ListJamiiPagesFilter {
  search?: string;
  county?: string;
  cause?: string;
  take?: number;
}

/** The Discover directory. Public, published pages only. */
export async function listJamiiPages(f: ListJamiiPagesFilter = {}) {
  return prisma.jamiiPage.findMany({
    where: {
      status: 'PUBLISHED',
      organisation: {
        ...(f.county ? { party: { county: f.county } } : {}),
        ...(f.cause ? { tags: { has: f.cause } } : {}),
        ...(f.search
          ? { officialName: { contains: f.search, mode: 'insensitive' as const } }
          : {}),
      },
    },
    include: {
      organisation: {
        include: {
          party: { include: { attestations: { where: { claimType: 'ORG_PAGE_VERIFIED', revokedAt: null }, take: 1 } } },
        },
      },
      campaigns: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 },
      domain: { where: { status: 'ACTIVE', removedAt: null } },
    },
    orderBy: { publishedAt: 'desc' },
    take: f.take ?? 50,
  });
}

/** Pages the signed-in person can manage — the dashboard's page picker. */
export async function listMyJamiiPages(ctx: Ctx) {
  if (!ctx.partyId) return [];
  return prisma.jamiiPage.findMany({
    where: { team: { some: { personId: ctx.partyId, removedAt: null } } },
    include: { organisation: true },
    orderBy: { createdAt: 'desc' },
  });
}

export interface UpdateJamiiPageInput {
  tagline?: string;
  missionShort?: string;
  visionShort?: string;
  aboutUs?: string;
  meetingSchedule?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  whatsapp?: string;
  faq?: { q: string; a: string }[];
  logoUrl?: string;
  logoStorageKey?: string;
  coverUrl?: string;
  coverStorageKey?: string;
  brandAccent?: string;
  brandAccentTwo?: string;
  brandAccentThree?: string;
  themeDefaultMode?: 'DARK' | 'LIGHT';
}

export async function updateJamiiPage(ctx: Ctx, pageId: string, patch: UpdateJamiiPageInput) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const page = await prisma.jamiiPage.update({
    where: { organisationId: pageId },
    data: { ...patch, faq: patch.faq ?? undefined },
  });
  await recordAudit(ctx, { action: 'jamii_page.updated', targetType: 'jamii_page', targetId: pageId });
  return page;
}

export async function publishJamiiPage(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'ADMIN');
  const page = await prisma.jamiiPage.update({
    where: { organisationId: pageId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
  await recordAudit(ctx, { action: 'jamii_page.published', targetType: 'jamii_page', targetId: pageId });
  return page;
}

export async function addJamiiPhoto(
  ctx: Ctx,
  pageId: string,
  input: { storageKey: string; url: string; caption?: string },
) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const count = await prisma.jamiiPhoto.count({ where: { pageId } });
  return prisma.jamiiPhoto.create({
    data: { pageId, storageKey: input.storageKey, url: input.url, caption: input.caption, position: count },
  });
}

export async function removeJamiiPhoto(ctx: Ctx, pageId: string, photoId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  await prisma.jamiiPhoto.delete({ where: { id: photoId } });
}

/* ═══════════════════════════ staff / admin ═══════════════════════════
 *
 * Everything above this line answers "what can the page's own team do".
 * These answer "what can Esoko staff, looking across every page, do" —
 * the admin app's Our Jamii > Pages screen. Same split as store.ts's
 * getStoreDetailForStaff vs. the enterprise-owner dashboard functions.
 */

export interface ListJamiiPagesForStaffFilter {
  status?: JamiiPageStatus;
  county?: string;
  search?: string;
  take?: number;
  skip?: number;
}

/** Every page, any status — unlike listJamiiPages (Discover, published
 *  only) or listMyJamiiPages (one person's own pages). */
export async function listJamiiPagesForStaff(ctx: Ctx, f: ListJamiiPagesForStaffFilter = {}) {
  requireCapability(ctx, 'jamii-page.read');

  const where = {
    status: f.status,
    organisation: {
      ...(f.county ? { party: { county: f.county } } : {}),
      ...(f.search ? { officialName: { contains: f.search, mode: 'insensitive' as const } } : {}),
    },
  };

  const [rows, total] = await Promise.all([
    prisma.jamiiPage.findMany({
      where,
      include: {
        organisation: {
          include: {
            party: {
              include: { attestations: { where: { claimType: 'ORG_PAGE_VERIFIED', revokedAt: null }, take: 1 } },
            },
          },
        },
        team: { where: { removedAt: null }, select: { id: true } },
        campaigns: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.jamiiPage.count({ where }),
  ]);
  return { rows, total };
}

/** Platform-wide counts, unaffected by whatever filter the screen is
 *  currently showing — same reasoning as store.ts's getStoreCounts. */
export async function getJamiiPageCounts(ctx: Ctx) {
  requireCapability(ctx, 'jamii-page.read');
  const [draft, published, suspended] = await Promise.all([
    prisma.jamiiPage.count({ where: { status: 'DRAFT' } }),
    prisma.jamiiPage.count({ where: { status: 'PUBLISHED' } }),
    prisma.jamiiPage.count({ where: { status: 'SUSPENDED' } }),
  ]);
  return { draft, published, suspended, total: draft + published + suspended };
}

/**
 * Staff moderation — suspend a page that's misrepresenting itself or
 * misusing donations, or reinstate one. Deliberately separate from
 * publishJamiiPage (self-service, requires page ADMIN) even though both
 * write `status`: this one needs no team membership, only the
 * platform-wide capability, and always leaves a reason on the record.
 */
export async function moderateJamiiPage(
  ctx: Ctx, pageId: string, status: 'PUBLISHED' | 'DRAFT' | 'SUSPENDED', reason: string,
) {
  requireCapability(ctx, 'jamii-page.moderate');
  if (!reason.trim()) throw new Error('A reason is required');

  const page = await prisma.jamiiPage.update({
    where: { organisationId: pageId },
    data: { status, publishedAt: status === 'PUBLISHED' ? new Date() : undefined },
  });

  await recordAudit(ctx, {
    action: status === 'SUSPENDED' ? 'jamii_page.suspended'
      : status === 'PUBLISHED' ? 'jamii_page.staff_published' : 'jamii_page.reverted_to_draft',
    targetType: 'jamii_page',
    targetId: pageId,
    payload: { reason },
  });
  return page;
}
