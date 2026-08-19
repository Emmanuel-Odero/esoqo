'use server';

import { revalidatePath } from 'next/cache';
import {
  publishJamiiPage, updateJamiiPage, createJamiiPost, publishJamiiPost,
  createCampaign, inviteTeamMember, removeTeamMember,
  requestJamiiDomain, removeJamiiDomain,
  markJamiiContactMessageRead, archiveJamiiContactMessage,
  createJamiiProgram, updateJamiiProgram, deleteJamiiProgram,
  setMemberRole, AuthorisationError,
} from '@esoko/db';
import {
  jamiiPageProfileSchema, jamiiFaqSchema, jamiiPostSchema, createCampaignSchema, inviteTeamMemberSchema,
  requestJamiiDomainSchema, jamiiProgramSchema, setMemberRoleSchema,
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

export async function actionCreateProgram(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiProgramSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await createJamiiProgram(ctx, pageId, parsed.data);
    revalidatePath('/dashboard/programs');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not add the programme' };
  }
}

export async function actionUpdateProgram(pageId: string, programId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiProgramSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateJamiiProgram(ctx, pageId, programId, parsed.data);
    revalidatePath('/dashboard/programs');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

export async function actionDeleteProgram(pageId: string, programId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteJamiiProgram(ctx, pageId, programId);
    revalidatePath('/dashboard/programs');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that programme' };
  }
}

/**
 * See LeadershipScreen's header comment — this calls the same
 * setMemberRole every other group-management surface uses, gated on
 * requireGroupOfficer (Chairperson/Treasurer/Secretary), not the
 * JamiiTeamMember page-access check every other action here runs on.
 * A page ADMIN who isn't also a recognised officer gets a clear message
 * instead of the raw "Denied: membership.write".
 */
export async function actionSetMemberRole(raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = setMemberRoleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await setMemberRole(ctx, parsed.data.membershipId, parsed.data.role as never, parsed.data.customRole);
    revalidatePath('/dashboard/leadership');
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof AuthorisationError) {
      return { ok: false, error: 'Only this group’s Chairperson, Treasurer or Secretary can change roles.' };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that change' };
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

export async function actionRequestDomain(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = requestJamiiDomainSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid domain' };
  try {
    await requestJamiiDomain(ctx, pageId, parsed.data.hostname);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not link that domain' };
  }
}

export async function actionRemoveDomain(pageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await removeJamiiDomain(ctx, pageId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove that domain' };
  }
}

export async function actionMarkMessageRead(pageId: string, messageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await markJamiiContactMessageRead(ctx, pageId, messageId);
    revalidatePath('/dashboard/messages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update that message' };
  }
}

export async function actionArchiveMessage(pageId: string, messageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await archiveJamiiContactMessage(ctx, pageId, messageId);
    revalidatePath('/dashboard/messages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not archive that message' };
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
