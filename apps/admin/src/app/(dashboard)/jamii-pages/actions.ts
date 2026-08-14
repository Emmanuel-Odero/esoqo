'use server';
import { revalidatePath } from 'next/cache';
import { moderateJamiiPage, issueOrgPageVerification, revokeOrgPageVerification, type JamiiPageStatus } from '@esoko/db';
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
