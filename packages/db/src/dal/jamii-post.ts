import { prisma } from '../client';
import { recordAudit } from '../audit';
import type { Ctx } from '../capabilities';
import { requirePageAccess } from './jamii-page';

export interface CreateJamiiPostInput {
  title: string;
  excerpt?: string;
  body: string;
  imageUrl?: string;
  imageStorageKey?: string;
}

export async function createJamiiPost(ctx: Ctx, pageId: string, input: CreateJamiiPostInput) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  if (!input.title.trim()) throw new Error('Give the update a title');
  if (!input.body.trim()) throw new Error('Write what happened');

  const post = await prisma.jamiiPost.create({
    data: {
      pageId,
      title: input.title.trim(),
      excerpt: input.excerpt?.trim() || null,
      body: input.body.trim(),
      imageUrl: input.imageUrl || null,
      imageStorageKey: input.imageStorageKey || null,
      authorPartyId: ctx.partyId ?? null,
    },
  });
  await recordAudit(ctx, { action: 'jamii_post.created', targetType: 'jamii_post', targetId: post.id });
  return post;
}

export async function publishJamiiPost(ctx: Ctx, pageId: string, postId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  const post = await prisma.jamiiPost.update({
    where: { id: postId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
  await recordAudit(ctx, { action: 'jamii_post.published', targetType: 'jamii_post', targetId: postId });
  return post;
}

export async function listJamiiPostsForOwner(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiPost.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' } });
}

export async function getJamiiPost(pageId: string, postId: string) {
  return prisma.jamiiPost.findFirst({ where: { id: postId, pageId, status: 'PUBLISHED' } });
}

export async function deleteJamiiPost(ctx: Ctx, pageId: string, postId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  await prisma.jamiiPost.delete({ where: { id: postId } });
}
