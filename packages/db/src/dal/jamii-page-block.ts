import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';
import type { JamiiBlockType, Prisma } from '@prisma/client';

/** Public — only visible rows, in display order, for one specific
 *  JamiiSitePage (home or any other page). Empty for any page that
 *  hasn't touched the dashboard's block editor yet; see
 *  OrgHomeSections.tsx's DefaultHomeSections fallback for what renders
 *  instead when the homepage's own call here returns []. */
export async function listJamiiPageBlocksPublic(sitePageId: string) {
  return prisma.jamiiPageBlock.findMany({
    where: { sitePageId, visible: true },
    orderBy: { position: 'asc' },
  });
}

/** Dashboard's own listing — includes hidden blocks too, so the editor
 *  shows everything a page has, not just what's currently live.
 *  `pageId` is only for the access check; blocks are scoped to
 *  `sitePageId`. */
export async function listJamiiPageBlocksForDashboard(ctx: Ctx, pageId: string, sitePageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiPageBlock.findMany({ where: { sitePageId }, orderBy: { position: 'asc' } });
}

export interface SaveJamiiPageBlockInput {
  id?: string;
  type: JamiiBlockType;
  visible: boolean;
  data: Prisma.InputJsonValue;
}

/**
 * Whole-list replace, same shape as updateJamiiPage's `faq` field: the
 * dashboard editor holds one page's entire block array client-side
 * (add, remove, reorder, edit-in-place) and saves it in one call.
 * `position` is derived from array order here, not sent by the client —
 * mirrors reorderProductImages (packages/db/src/dal/product.ts).
 */
export async function saveJamiiPageBlocks(
  ctx: Ctx, pageId: string, sitePageId: string, blocks: SaveJamiiPageBlockInput[],
) {
  await requirePageAccess(ctx, pageId, 'EDITOR');

  const keepIds = blocks.map((b) => b.id).filter((id): id is string => Boolean(id));

  await prisma.$transaction([
    prisma.jamiiPageBlock.deleteMany({ where: { sitePageId, id: { notIn: keepIds } } }),
    ...blocks.map((b, position) => (b.id
      ? prisma.jamiiPageBlock.update({
          where: { id: b.id, sitePageId },
          data: { type: b.type, visible: b.visible, data: b.data, position },
        })
      : prisma.jamiiPageBlock.create({
          data: { pageId, sitePageId, type: b.type, visible: b.visible, data: b.data, position },
        }))),
  ]);

  await recordAudit(ctx, {
    action: 'jamii_page_block.saved', targetType: 'jamii_page', targetId: pageId,
    payload: { sitePageId, count: blocks.length },
  });
}
