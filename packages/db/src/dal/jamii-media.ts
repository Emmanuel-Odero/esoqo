import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { JamiiMediaCategory } from '@prisma/client';

/**
 * Platform-wide "no photo yet" placeholders — see the schema file's
 * JamiiMediaAsset header. Public read (any published page may need a
 * placeholder for an empty hero/gallery/post slot); writes are staff-only
 * (jamii-media.manage), never per-org — an individual group has no way
 * to add its own pattern, only the platform curates the available set.
 */

/** Public — no ctx. Active patterns for a category, in curated order. */
export async function listActiveMediaAssets(category: JamiiMediaCategory) {
  return prisma.jamiiMediaAsset.findMany({
    where: { category, active: true },
    orderBy: { position: 'asc' },
  });
}

export async function listMediaAssetsForStaff(ctx: Ctx) {
  requireCapability(ctx, 'jamii-media.manage');
  return prisma.jamiiMediaAsset.findMany({ orderBy: [{ category: 'asc' }, { position: 'asc' }] });
}

export async function setMediaAssetActive(ctx: Ctx, id: string, active: boolean) {
  requireCapability(ctx, 'jamii-media.manage');
  const asset = await prisma.jamiiMediaAsset.update({ where: { id }, data: { active } });
  await recordAudit(ctx, {
    action: active ? 'jamii_media.enabled' : 'jamii_media.disabled',
    targetType: 'jamii_media_asset', targetId: id, payload: { key: asset.key },
  });
  return asset;
}

export async function updateMediaAssetLabel(ctx: Ctx, id: string, label: string) {
  requireCapability(ctx, 'jamii-media.manage');
  if (!label.trim()) throw new Error('A label is required');
  return prisma.jamiiMediaAsset.update({ where: { id }, data: { label: label.trim() } });
}
