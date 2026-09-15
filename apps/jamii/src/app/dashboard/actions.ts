'use server';

import { revalidatePath } from 'next/cache';
import {
  publishJamiiPage, updateJamiiPage, updateJamiiOrgProfile, createJamiiPost, publishJamiiPost,
  updateJamiiPost, deleteJamiiPost, updateJamiiPhotoCaption,
  createCampaign, updateCampaign, addCampaignUpdate, deleteCampaignUpdate, inviteTeamMember, removeTeamMember,
  requestJamiiDomain, removeJamiiDomain,
  markJamiiContactMessageRead, archiveJamiiContactMessage,
  createJamiiProgram, updateJamiiProgram, deleteJamiiProgram,
  setMemberRole, AuthorisationError, saveJamiiPageBlocks,
  createJamiiSitePage, updateJamiiSitePage, publishJamiiSitePage, deleteJamiiSitePage,
  saveJamiiNavItems, createSupportTicket,
} from '@esoqo/db';
import {
  jamiiPageProfileSchema, jamiiOrgProfileSchema, jamiiFaqSchema, jamiiPostSchema, createCampaignSchema, updateCampaignSchema,
  campaignUpdateSchema,
  inviteTeamMemberSchema, requestJamiiDomainSchema, jamiiProgramSchema, setMemberRoleSchema,
  jamiiPageBlocksSchema, jamiiCreateSitePageSchema, jamiiUpdateSitePageSchema, jamiiNavItemsSchema,
  createSupportTicketSchema,
} from '@esoqo/domain';
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
    revalidatePath('/dashboard/pages', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

/** The About page's "At a glance" card — see updateJamiiOrgProfile's
 *  own header comment for why this is a separate write from
 *  actionUpdateProfile above even though both save from the same
 *  screen. */
export async function actionUpdateOrgProfile(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiOrgProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateJamiiOrgProfile(ctx, pageId, parsed.data as never);
    revalidatePath('/dashboard/pages', 'layout');
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
    revalidatePath('/dashboard/pages', 'layout');
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

export async function actionUpdatePost(pageId: string, postId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiPostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateJamiiPost(ctx, pageId, postId, parsed.data);
    revalidatePath('/dashboard/posts');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

export async function actionDeletePost(pageId: string, postId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteJamiiPost(ctx, pageId, postId);
    revalidatePath('/dashboard/posts');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that update' };
  }
}

export async function actionUpdatePhotoCaption(pageId: string, photoId: string, caption: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await updateJamiiPhotoCaption(ctx, pageId, photoId, caption);
    revalidatePath('/dashboard/gallery');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that caption' };
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

export async function actionUpdateCampaign(pageId: string, campaignId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = updateCampaignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateCampaign(ctx, pageId, campaignId, {
      ...parsed.data,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
    });
    revalidatePath('/dashboard/campaigns');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

/** The "Updates" timeline donors see on the public campaign page — see
 *  addCampaignUpdate's own header comment; this had no dashboard
 *  action at all before, despite the DAL function existing. */
export async function actionAddCampaignUpdate(
  pageId: string, campaignId: string, raw: unknown,
): Promise<ActionResult<{ id: string; title: string; body: string; postedAt: Date }>> {
  const ctx = await requireSubject();
  const parsed = campaignUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    // Returned rather than just revalidating — the client holds its
    // own copy of the updates list (see CampaignUpdatesPanel), and
    // revalidatePath alone doesn't refresh an already-mounted Client
    // Component's state, only what a fresh navigation would receive.
    const update = await addCampaignUpdate(ctx, pageId, campaignId, parsed.data.title, parsed.data.body);
    revalidatePath('/dashboard/campaigns');
    return { ok: true, data: update };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not post that update' };
  }
}

export async function actionDeleteCampaignUpdate(pageId: string, campaignId: string, updateId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteCampaignUpdate(ctx, pageId, campaignId, updateId);
    revalidatePath('/dashboard/campaigns');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that update' };
  }
}

/** Whole-list save for any page's block editor (Homepage screen and
 *  the generic Pages screen alike) — same requireSubject -> safeParse
 *  -> DAL -> revalidatePath shape as every other action here, just
 *  against an array instead of one record (see saveJamiiPageBlocks's
 *  own header comment for the replace semantics). */
export async function actionSavePageBlocks(pageId: string, sitePageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiPageBlocksSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your page sections' };
  try {
    await saveJamiiPageBlocks(
      ctx, pageId, sitePageId,
      parsed.data.map(({ id, type, visible, data }) => ({ id, type, visible, data })),
    );
    revalidatePath('/dashboard/homepage');
    revalidatePath('/dashboard/pages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your page' };
  }
}

export async function actionCreatePage(pageId: string, raw: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  const ctx = await requireSubject();
  const parsed = jamiiCreateSitePageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the page title' };
  try {
    const row = await createJamiiSitePage(ctx, pageId, parsed.data);
    revalidatePath('/dashboard/pages');
    return { ok: true, data: { id: row.id, slug: row.slug } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create that page' };
  }
}

export async function actionUpdatePage(pageId: string, sitePageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiUpdateSitePageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await updateJamiiSitePage(ctx, pageId, sitePageId, parsed.data);
    revalidatePath('/dashboard/pages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your changes' };
  }
}

export async function actionPublishPageDraft(pageId: string, sitePageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await publishJamiiSitePage(ctx, pageId, sitePageId);
    revalidatePath('/dashboard/pages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not publish that page' };
  }
}

export async function actionDeletePage(pageId: string, sitePageId: string): Promise<ActionResult> {
  const ctx = await requireSubject();
  try {
    await deleteJamiiSitePage(ctx, pageId, sitePageId);
    revalidatePath('/dashboard/pages');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete that page' };
  }
}

/** Whole-list save for the Navigation screen — same replace semantics
 *  as actionSavePageBlocks, against saveJamiiNavItems instead. */
export async function actionSaveNavItems(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = jamiiNavItemsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your navigation menu' };
  try {
    await saveJamiiNavItems(ctx, pageId, parsed.data);
    revalidatePath('/dashboard/navigation');
    revalidatePath('/o/[slug]', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your navigation menu' };
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

/** "Report an issue" — pageId is just the "what were you working on"
 *  context (see SupportTicket's own doc comment), not an access check;
 *  raising a ticket only requires being signed in. */
export async function actionCreateSupportTicket(pageId: string, raw: unknown): Promise<ActionResult> {
  const ctx = await requireSubject();
  const parsed = createSupportTicketSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details' };
  try {
    await createSupportTicket(ctx, { ...parsed.data, pageId });
    revalidatePath('/dashboard/support');
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not raise that ticket' };
  }
}
