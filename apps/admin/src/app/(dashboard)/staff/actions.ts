'use server';
import { revalidatePath } from 'next/cache';
import { setCapabilities, applyRolePreset, setStaffActive, createStaff, type RoleName } from '@esoqo/db';
import { hashPin, generateTempPin, sendEmail } from '@esoqo/auth';
import { toSafeErrorMessage } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3002';

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

/**
 * Creates an account with a temporary PIN the person must change, and
 * emails them the sign-in link plus that PIN — the account is useless
 * to them until they have both, and "hand the PIN over in person" was
 * the only way that ever happened before this, which doesn't scale
 * past the person who created the account being in the same room.
 *
 * Best-effort on the email itself, same convention groups/actions.ts's
 * tellThemTheyWereAdded already follows: the account is the source of
 * truth, and a admin shouldn't see "that didn't save" because an SMTP
 * relay was briefly down. The PIN is still returned and shown on
 * screen either way, so a failed send has a fallback: hand it over
 * directly, same as before this existed.
 */
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

    let emailed = true;
    try {
      await sendEmail(
        input.email, 'Your Esoqo admin account',
        `Hi ${input.name},\n\n`
        + `An Esoqo admin account has been created for you.\n\n`
        + `Sign in: ${ADMIN_URL}/signin\n`
        + `Email: ${input.email}\n`
        + `Temporary PIN: ${tempPin}\n\n`
        + `Enter that email and PIN to sign in, then you'll be asked to choose your own PIN before you can do anything else.\n\n`
        + `Esoqo will never ask you for your PIN.`,
      );
    } catch (e) {
      console.error('[staff] invite email failed', e);
      emailed = false;
    }

    // Returned once, shown once. Never stored in plaintext.
    return { ok: true, data: { tempPin, emailed } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That account wasn't created — check the email isn't already in use, then try again.") };
  }
}
