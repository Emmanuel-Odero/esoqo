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

export interface UpdateJamiiPostInput {
  title: string;
  excerpt?: string;
  body: string;
  imageUrl?: string;
  imageStorageKey?: string;
}

/** A post is published the moment it's created (actionCreatePost calls
 *  publishJamiiPost right away — there's no real draft workflow), so
 *  editing an already-live update is the normal case, not an edge
 *  case: fixing a typo or a broken link shouldn't mean deleting and
 *  re-posting under a new URL. */
export async function updateJamiiPost(ctx: Ctx, pageId: string, postId: string, input: UpdateJamiiPostInput) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  if (!input.title.trim()) throw new Error('Give the update a title');
  if (!input.body.trim()) throw new Error('Write what happened');

  const post = await prisma.jamiiPost.update({
    where: { id: postId, pageId },
    data: {
      title: input.title.trim(),
      excerpt: input.excerpt?.trim() || null,
      body: input.body.trim(),
      imageUrl: input.imageUrl || null,
      imageStorageKey: input.imageStorageKey || null,
    },
  });
  await recordAudit(ctx, { action: 'jamii_post.updated', targetType: 'jamii_post', targetId: postId });
  return post;
}

export async function listJamiiPostsForOwner(ctx: Ctx, pageId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiPost.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' } });
}

export async function getJamiiPost(pageId: string, postId: string) {
  return prisma.jamiiPost.findFirst({ where: { id: postId, pageId, status: 'PUBLISHED' } });
}

/** Dashboard's own lookup for the edit screen — unlike getJamiiPost,
 *  not limited to PUBLISHED, so a post somehow left in DRAFT is still
 *  editable, not just findable in the list. */
export async function getJamiiPostForManagement(ctx: Ctx, pageId: string, postId: string) {
  await requirePageAccess(ctx, pageId, 'CONTRIBUTOR');
  return prisma.jamiiPost.findFirst({ where: { id: postId, pageId } });
}

export async function deleteJamiiPost(ctx: Ctx, pageId: string, postId: string) {
  await requirePageAccess(ctx, pageId, 'EDITOR');
  await prisma.jamiiPost.delete({ where: { id: postId } });
}
