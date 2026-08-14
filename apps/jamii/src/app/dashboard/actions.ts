'use server';

import { revalidatePath } from 'next/cache';
import {
  publishJamiiPage, updateJamiiPage, createJamiiPost, publishJamiiPost,
  createCampaign, inviteTeamMember, removeTeamMember,
} from '@esoko/db';
import {
  jamiiPageProfileSchema, jamiiFaqSchema, jamiiPostSchema, createCampaignSchema, inviteTeamMemberSchema,
} from '@esoko/domain';
import { requireSubject } from '@/lib/session';

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export async function actionPublishPage(pageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await publishJamiiPage(ctx, pageId);
    revalidatePath('/dashboard');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not publish your page' };
  }
}

export async function actionUpdateProfile(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiPageProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateJamiiPage(ctx, pageId, parsed.data);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

export async function actionUpdateFaq(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiFaqSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your FAQ entries' };
  try {
    await updateJamiiPage(ctx, pageId, { faq: parsed.data });
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your FAQ' };
  }
}

export async function actionCreatePost(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiPostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    const post = await createJamiiPost(ctx, pageId, parsed.data);
    await publishJamiiPost(ctx, pageId, post.id);
    revalidatePath('/dashboard/posts');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not publish your update' };
  }
}

export async function actionCreateCampaign(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await createCampaign(ctx, pageId, {
      ...parsed.data,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
    });
    revalidatePath('/dashboard/campaigns');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not open the campaign' };
  }
}

export async function actionInviteTeamMember(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = inviteTeamMemberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await inviteTeamMember(ctx, pageId, parsed.data);
    revalidatePath('/dashboard/team');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the invite' };
  }
}

export async function actionRemoveTeamMember(pageId: string, memberId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await removeTeamMember(ctx, pageId, memberId);
    revalidatePath('/dashboard/team');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove that person' };
  }
}
