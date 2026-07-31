'use server';
import { revalidatePath } from 'next/cache';
import { setCapabilities, applyRolePreset, setStaffActive, createStaff, type RoleName } from '@esoko/db';
import { hashPin, generateTempPin } from '@esoko/auth';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true; data?: unknown } | { ok: false; error: string };

export async function actionSetCapabilities(staffId: string, capabilities: string[]): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setCapabilities(ctx, staffId, capabilities);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update permissions' };
  }
}

export async function actionApplyPreset(staffId: string, preset: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await applyRolePreset(ctx, staffId, preset as RoleName);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not apply that role' };
  }
}

export async function actionSetActive(staffId: string, active: boolean, reason?: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setStaffActive(ctx, staffId, active, reason);
    revalidatePath('/staff');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not change that account' };
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
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create that account' };
  }
}
