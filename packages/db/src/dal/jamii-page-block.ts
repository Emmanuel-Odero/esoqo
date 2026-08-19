import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';
import type { JamiiBlockType, Prisma } from '@prisma/client';

/** Public homepage — only visible rows, in display order. Empty for
 *  any page that hasn't touched the dashboard's block editor yet; see
 *  OrgHomeSections.tsx's DefaultHomeSections fallback for what renders
 *  instead when this returns []. */
export async function listJamiiPageBlocksPublic(pageId: string) {
  return prisma.jamiiPageBlock.findMany({
    where: { pageId, visible: true },
    orderBy: { position: 'asc' },
  });
}

/** Dashboard's own listing — includes hidden blocks too, so the editor
 *  shows everything an org has, not just what's currently live. */
export async function listJamiiPageBlocksForDashboard(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiPageBlock.findMany({ where: { pageId }, orderBy: { position: 'asc' } });
}

export interface SaveJamiiPageBlockInput {
  id?: string;
  type: JamiiBlockType;
  visible: boolean;
  data: Prisma.InputJsonValue;
}

/**
 * Whole-list replace, same shape as updateJamiiPage's `faq` field: the
 * dashboard editor holds the entire block array client-side (add,
 * remove, reorder, edit-in-place) and saves it in one call. `position`
 * is derived from array order here, not sent by the client — mirrors
 * reorderProductImages (packages/db/src/dal/product.ts).
 */
export async function saveJamiiPageBlocks(ctx: Ctx, pageId: string, blocks: SaveJamiiPageBlockInput[]) {
  await requirePageAccess(ctx, pageId, 'EDITOR');

  const keepIds = blocks.map((b) => b.id).filter((id): id is string => Boolean(id));

  await prisma.$transaction([
    prisma.jamiiPageBlock.deleteMany({ where: { pageId, id: { notIn: keepIds } } }),
    ...blocks.map((b, position) => (b.id
      ? prisma.jamiiPageBlock.update({
          where: { id: b.id, pageId },
          data: { type: b.type, visible: b.visible, data: b.data, position },
        })
      : prisma.jamiiPageBlock.create({
          data: { pageId, type: b.type, visible: b.visible, data: b.data, position },
        }))),
  ]);

  await recordAudit(ctx, {
    action: 'jamii_page_block.saved', targetType: 'jamii_page', targetId: pageId,
    payload: { count: blocks.length },
  });
}
