'use server';
import { revalidatePath } from 'next/cache';
import {
  moderateJamiiPage, issueOrgPageVerification, revokeOrgPageVerification, type JamiiPageStatus,
  inviteTeamMember, removeTeamMember, listTeamMembers, type JamiiTeamRole,
  suspendJamiiDomain, reinstateJamiiDomain, staffRemoveJamiiDomain,
} from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionModeratePage(
  pageId: string, status: JamiiPageStatus, reason: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await moderateJamiiPage(ctx, pageId, status, reason);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionVerifyPage(organisationPartyId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await issueOrgPageVerification(ctx, organisationPartyId);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionUnverifyPage(organisationPartyId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await revokeOrgPageVerification(ctx, organisationPartyId, reason);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

/* ── custom domain ────────────────────────────────────────────── */

export async function actionSuspendDomain(domainId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await suspendJamiiDomain(ctx, domainId, reason);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionReinstateDomain(domainId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await reinstateJamiiDomain(ctx, domainId);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

export async function actionRemoveDomain(domainId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await staffRemoveJamiiDomain(ctx, domainId, reason);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}

/* ── page team ────────────────────────────────────────────────── */

/** Every chama/organisation's own team manages its page day to day —
 *  this is only for onboarding: inviting a group's first admin (or
 *  standing in for them) while you're helping them get set up. Staff
 *  reach this via requirePageAccess's party.write bypass. */
export async function actionListTeam(pageId: string) {
  const ctx = await requireStaff();
  const members = await listTeamMembers(ctx, pageId);
  return members.map((m) => ({
    id: m.id, name: m.inviteName, email: m.inviteEmail, role: m.role,
    accepted: Boolean(m.acceptedAt),
  }));
}

export async function actionInviteTeamMember(
  pageId: string, input: { name: string; email: string; role: JamiiTeamRole },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await inviteTeamMember(ctx, pageId, input);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That invite didn't send. Please try again.") };
  }
}

export async function actionRemoveTeamMember(pageId: string, memberId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await removeTeamMember(ctx, pageId, memberId);
    revalidatePath('/jamii-pages');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
