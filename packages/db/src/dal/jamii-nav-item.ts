import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';

/**
 * An org's nav — see schema.prisma's JamiiNavItem doc comment and
 * org-links-shared.ts's ORG_NAV_SECTIONS, the hardcoded list this
 * replaces. "Home" is deliberately never a stored row — both nav
 * components prepend it themselves (see WHITELABEL_NAV_SECTIONS) —
 * so every row here targets either a JamiiSitePage or an external URL.
 */

/** Public — visible items only, in display order, target page resolved
 *  so the renderer never has to do a second query per row. Used by
 *  OrgTopNav/OrgSubnav. */
export async function listJamiiNavItemsPublic(pageId: string) {
  return prisma.jamiiNavItem.findMany({
    where: { pageId, visible: true },
    include: { targetSitePage: true },
    orderBy: { position: 'asc' },
  });
}

/** Dashboard's Navigation screen — every item, hidden ones included. */
export async function listJamiiNavItemsForDashboard(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiNavItem.findMany({
    where: { pageId },
    include: { targetSitePage: true },
    orderBy: { position: 'asc' },
  });
}

export interface SaveJamiiNavItemInput {
  id?: string;
  label: string;
  visible: boolean;
  openInNewTab: boolean;
  targetKind: 'SITE_PAGE' | 'EXTERNAL_URL';
  targetSitePageId?: string;
  externalUrl?: string;
}

/**
 * Whole-list replace — same shape as saveJamiiPageBlocks: the
 * Navigation screen holds the entire ordered list client-side (add,
 * remove, reorder, rename, retarget) and saves it in one call.
 * `position` is derived from array order, not sent by the client.
 */
export async function saveJamiiNavItems(ctx: Ctx, pageId: string, items: SaveJamiiNavItemInput[]) {
  await requirePageAccess(ctx, pageId, 'EDITOR');

  for (const item of items) {
    if (item.targetKind === 'SITE_PAGE' && !item.targetSitePageId) {
      throw new Error(`"${item.label}" needs a page to link to`);
    }
    if (item.targetKind === 'EXTERNAL_URL' && !item.externalUrl?.trim()) {
      throw new Error(`"${item.label}" needs a URL`);
    }
  }

  const keepIds = items.map((i) => i.id).filter((id): id is string => Boolean(id));

  await prisma.$transaction([
    prisma.jamiiNavItem.deleteMany({ where: { pageId, id: { notIn: keepIds } } }),
    ...items.map((item, position) => {
      const data = {
        label: item.label.trim(),
        visible: item.visible,
        openInNewTab: item.openInNewTab,
        targetKind: item.targetKind,
        targetSitePageId: item.targetKind === 'SITE_PAGE' ? item.targetSitePageId : null,
        externalUrl: item.targetKind === 'EXTERNAL_URL' ? item.externalUrl!.trim() : null,
        position,
      };
      return item.id
        ? prisma.jamiiNavItem.update({ where: { id: item.id, pageId }, data })
        : prisma.jamiiNavItem.create({ data: { ...data, pageId } });
    }),
  ]);

  await recordAudit(ctx, {
    action: 'jamii_nav_item.saved', targetType: 'jamii_page', targetId: pageId,
    payload: { count: items.length },
  });
}
