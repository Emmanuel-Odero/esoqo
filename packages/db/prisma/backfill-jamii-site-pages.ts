import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * One-time data touch-up for the generic-CMS migration (JamiiSitePage/
 * JamiiNavItem — see schema.prisma's comments on both models). Every
 * existing JamiiPage gets the same 9 rows the old fixed routes implied
 * — SYSTEM_HOME plus the 8 sections in org-links-shared.ts's
 * ORG_NAV_SECTIONS — with slugs matching today's URLs exactly, so
 * nothing about a live page's address or SEO changes the moment this
 * runs. Existing JamiiPageBlock rows (today, always homepage blocks)
 * get pointed at the new SYSTEM_HOME row via sitePageId.
 *
 * Idempotent: a page that already has a SYSTEM_HOME row is skipped
 * entirely, so reruns (e.g. after a fresh seed) are harmless.
 *
 * Run with: pnpm --filter @esoqo/db backfill:jamii-site-pages
 */

/** kind, slug, title/label — label matches ORG_NAV_SECTIONS/
 *  WHITELABEL_NAV_SECTIONS in apps/jamii/src/lib/org-links-shared.ts
 *  exactly, so a freshly-backfilled nav reads identically to today's
 *  hardcoded one. SYSTEM_HOME has no nav item of its own here — both
 *  nav components special-case "Home" as a prepended entry rather than
 *  a stored one; see that file's header comment. */
const SYSTEM_PAGES = [
  { kind: 'SYSTEM_HOME', slug: '', title: 'Home' },
  { kind: 'SYSTEM_ABOUT', slug: 'about', title: 'About' },
  { kind: 'SYSTEM_PROGRAMS', slug: 'programs', title: 'Programs' },
  { kind: 'SYSTEM_CAMPAIGNS', slug: 'campaigns', title: 'Campaigns' },
  { kind: 'SYSTEM_POSTS', slug: 'posts', title: 'Posts' },
  { kind: 'SYSTEM_GALLERY', slug: 'gallery', title: 'Gallery' },
  { kind: 'SYSTEM_LEADERSHIP', slug: 'leadership', title: 'Leadership' },
  { kind: 'SYSTEM_FAQ', slug: 'faq', title: 'FAQ' },
  { kind: 'SYSTEM_CONTACT', slug: 'contact', title: 'Contact' },
] as const;

async function main() {
  let pagesTouched = 0;
  let blocksMoved = 0;

  const pages = await prisma.jamiiPage.findMany({ select: { organisationId: true } });

  for (const page of pages) {
    const already = await prisma.jamiiSitePage.findFirst({
      where: { pageId: page.organisationId, kind: 'SYSTEM_HOME' },
      select: { id: true },
    });
    if (already) continue;

    await prisma.$transaction(async (tx) => {
      const created = new Map<string, string>(); // kind -> new JamiiSitePage id

      for (const sp of SYSTEM_PAGES) {
        // PUBLISHED regardless of the org's own JamiiPage.status —
        // nothing gates public rendering on a SYSTEM_* page's own
        // status, only CUSTOM pages' status does (getJamiiSitePageBySlug).
        const row = await tx.jamiiSitePage.create({
          data: { pageId: page.organisationId, kind: sp.kind, slug: sp.slug, title: sp.title, status: 'PUBLISHED' },
        });
        created.set(sp.kind, row.id);
      }

      // Nav items — every section but Home, same order/visibility as
      // today's ORG_NAV_SECTIONS const.
      let position = 0;
      for (const sp of SYSTEM_PAGES) {
        if (sp.kind === 'SYSTEM_HOME') continue;
        await tx.jamiiNavItem.create({
          data: {
            pageId: page.organisationId,
            label: sp.title,
            targetKind: 'SITE_PAGE',
            targetSitePageId: created.get(sp.kind)!,
            position: position++,
            visible: true,
          },
        });
      }

      // Existing homepage blocks belong to SYSTEM_HOME now.
      const homeId = created.get('SYSTEM_HOME')!;
      const moved = await tx.jamiiPageBlock.updateMany({
        where: { pageId: page.organisationId, sitePageId: null },
        data: { sitePageId: homeId },
      });
      blocksMoved += moved.count;
    });

    pagesTouched++;
  }

  console.log(`Backfilled ${pagesTouched} page(s), moved ${blocksMoved} block(s) onto SYSTEM_HOME.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
