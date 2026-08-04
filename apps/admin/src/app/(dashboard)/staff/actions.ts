'use server';
import { revalidatePath } from 'next/cache';
import { setCapabilities, applyRolePreset, setStaffActive, createStaff, type RoleName } from '@esoko/db';
import { hashPin, generateTempPin } from '@esoko/auth';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true; data?: unknown } | { ok: false; error: string };

export async function actionSetCapabilities(staffId: string, capabilities: string[]): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setCapabilities(ctx, staffId, capabilities);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "Those permissions didn't save. Try again — if it keeps failing, check whether you still hold the capability you're trying to grant.") };
  }
}

export async function actionApplyPreset(staffId: string, preset: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await applyRolePreset(ctx, staffId, preset as RoleName);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That role didn't apply. Please try again.") };
  }
}

export async function actionSetActive(staffId: string, active: boolean, reason?: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setStaffActive(ctx, staffId, active, reason);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That account status didn't change. Please try again.") };
  }
}

/** Creates an account with a temporary PIN the person must change. */
export async function actionCreateStaff(input: {
  email: string; name: string; rolePreset: string;
}): Promise<Result> {
  try {
    const ctx = await requireStaff();
    const tempPin = generateTempPin();
    await createStaff(ctx, {
      email: input.email, name: input.name,
      rolePreset: input.rolePreset as RoleName,
      pinHash: await hashPin(tempPin),
    });
    revalidatePath('/staff');
    // Returned once, shown once. Never stored in plaintext.
    return { ok: true, data: { tempPin } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That account wasn't created — check the email isn't already in use, then try again.") };
  }
}
