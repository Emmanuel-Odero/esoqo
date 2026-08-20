import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';
import type { JamiiSitePageKind } from '@prisma/client';

/**
 * The generic-CMS page list — home, the seeded SYSTEM_* sections, and
 * any CUSTOM page an org has created. See schema.prisma's JamiiSitePage
 * doc comment for the SYSTEM_* vs. CUSTOM split; backfill-jamii-site-
 * pages.ts is what seeded the SYSTEM_* rows for pages that pre-date
 * this table.
 */

export class JamiiSitePageError extends Error {
  constructor(
    msg: string,
    public readonly code: 'NOT_FOUND' | 'SLUG_TAKEN' | 'SYSTEM_PAGE',
  ) {
    super(msg);
    this.name = 'JamiiSitePageError';
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/** Public — only a published page's published site pages are ever
 *  resolvable by the generic (site)/o/[slug]/[page] route. */
export async function getJamiiSitePageBySlug(pageId: string, slug: string) {
  return prisma.jamiiSitePage.findFirst({
    where: { pageId, slug, status: 'PUBLISHED' },
  });
}

/** sitemap.ts's per-org custom-domain case — every published CUSTOM
 *  page for one org. */
export async function listPublishedJamiiCustomPagesForOrg(pageId: string) {
  return prisma.jamiiSitePage.findMany({
    where: { pageId, kind: 'CUSTOM', status: 'PUBLISHED' },
    select: { slug: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** sitemap.ts's primary-domain case — every published CUSTOM page
 *  across every org, grouped by org slug so the sitemap can build
 *  `/o/{slug}/{page-slug}` without a query per org. */
export async function listPublishedJamiiCustomPages() {
  return prisma.jamiiSitePage.findMany({
    where: { kind: 'CUSTOM', status: 'PUBLISHED', page: { status: 'PUBLISHED' } },
    select: { slug: true, page: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Resolve one of the 9 seeded SYSTEM_* rows — e.g. the homepage
 *  (SYSTEM_HOME) needs its own JamiiSitePage id to look up its blocks,
 *  without a public visitor's `slug` in hand the way getJamiiSitePage-
 *  BySlug has. Ignores publish status — callers decide what to do with
 *  an unpublished system page (the homepage is effectively always
 *  "published" via the org's own JamiiPage.status instead). */
export async function getJamiiSitePageByKind(pageId: string, kind: JamiiSitePageKind) {
  return prisma.jamiiSitePage.findFirst({ where: { pageId, kind } });
}

/** Dashboard's "Pages" list — every page regardless of status, SYSTEM_*
 *  first (schema creation order) then CUSTOM by recency. */
export async function listJamiiSitePagesForDashboard(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  const rows = await prisma.jamiiSitePage.findMany({ where: { pageId } });
  return rows.sort((a, b) => {
    const aSystem = a.kind !== 'CUSTOM';
    const bSystem = b.kind !== 'CUSTOM';
    if (aSystem !== bSystem) return aSystem ? -1 : 1;
    return aSystem ? a.kind.localeCompare(b.kind) : b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export async function getJamiiSitePageForDashboard(ctx: Ctx, pageId: string, sitePageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  const row = await prisma.jamiiSitePage.findUnique({ where: { id: sitePageId } });
  if (!row || row.pageId !== pageId) throw new JamiiSitePageError('Page not found', 'NOT_FOUND');
  return row;
}

export interface CreateJamiiSitePageInput {
  title: string;
}

/** "New page" — always CUSTOM; SYSTEM_* rows only ever come from the
 *  backfill / page-creation transaction, never this. */
export async function createJamiiSitePage(ctx: Ctx, pageId: string, input: CreateJamiiSitePageInput) {
  await requirePageAccess(ctx, pageId, 'EDITOR');

  const title = input.title.trim();
  if (!title) throw new Error('Give the page a title');

  const base = slugify(title) || 'page';
  let slug = base;
  for (let n = 1; await prisma.jamiiSitePage.findUnique({ where: { pageId_slug: { pageId, slug } } }); n++) {
    slug = `${base}-${n}`;
  }

  const row = await prisma.jamiiSitePage.create({
    data: { pageId, kind: 'CUSTOM', slug, title, status: 'DRAFT' },
  });

  await recordAudit(ctx, {
    action: 'jamii_site_page.created', targetType: 'jamii_page', targetId: pageId,
    payload: { sitePageId: row.id, slug },
  });
  return row;
}

export interface UpdateJamiiSitePageInput {
  title?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
}

export async function updateJamiiSitePage(
  ctx: Ctx, pageId: string, sitePageId: string, patch: UpdateJamiiSitePageInput,
) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const existing = await prisma.jamiiSitePage.findUnique({ where: { id: sitePageId } });
  if (!existing || existing.pageId !== pageId) throw new JamiiSitePageError('Page not found', 'NOT_FOUND');

  const row = await prisma.jamiiSitePage.update({ where: { id: sitePageId }, data: patch });
  await recordAudit(ctx, {
    action: 'jamii_site_page.updated', targetType: 'jamii_page', targetId: pageId,
    payload: { sitePageId },
  });
  return row;
}

export async function publishJamiiSitePage(ctx: Ctx, pageId: string, sitePageId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const existing = await prisma.jamiiSitePage.findUnique({ where: { id: sitePageId } });
  if (!existing || existing.pageId !== pageId) throw new JamiiSitePageError('Page not found', 'NOT_FOUND');

  const row = await prisma.jamiiSitePage.update({ where: { id: sitePageId }, data: { status: 'PUBLISHED' } });
  await recordAudit(ctx, {
    action: 'jamii_site_page.published', targetType: 'jamii_page', targetId: pageId,
    payload: { sitePageId },
  });
  return row;
}

/** CUSTOM only — a SYSTEM_* page (About, FAQ, ...) is permanent; its
 *  slug is what today's SEO/back-links rely on. Deleting a page also
 *  drops any JamiiNavItem pointing at it (schema-level cascade). */
export async function deleteJamiiSitePage(ctx: Ctx, pageId: string, sitePageId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const existing = await prisma.jamiiSitePage.findUnique({ where: { id: sitePageId } });
  if (!existing || existing.pageId !== pageId) throw new JamiiSitePageError('Page not found', 'NOT_FOUND');
  if (existing.kind !== 'CUSTOM') {
    throw new JamiiSitePageError('This page is part of every site and can’t be deleted', 'SYSTEM_PAGE');
  }

  await prisma.jamiiSitePage.delete({ where: { id: sitePageId } });
  await recordAudit(ctx, {
    action: 'jamii_site_page.deleted', targetType: 'jamii_page', targetId: pageId,
    payload: { sitePageId, slug: existing.slug },
  });
}

export const JAMII_SITE_PAGE_KIND_LABELS: Record<JamiiSitePageKind, string> = {
  SYSTEM_HOME: 'Home', SYSTEM_ABOUT: 'About', SYSTEM_PROGRAMS: 'Programs',
  SYSTEM_CAMPAIGNS: 'Campaigns', SYSTEM_POSTS: 'Posts', SYSTEM_GALLERY: 'Gallery',
  SYSTEM_LEADERSHIP: 'Leadership', SYSTEM_FAQ: 'FAQ', SYSTEM_CONTACT: 'Contact',
  CUSTOM: 'Custom page',
};
