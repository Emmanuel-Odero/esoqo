'use server';

import { revalidatePath } from 'next/cache';
import { setTicketOrgStatus, createTicketOrgStaff, setTicketOrgStaffActive } from '@esoko/db';
import { hashPin } from '@esoko/auth';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionModerateOrg(orgId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setTicketOrgStatus(ctx, orgId, status);
    revalidatePath('/ticketing');
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That organiser's status didn't change. Please try again.") };
  }
}

/** Adds an org staff member (ticket seller, gate scanner, manager) on
 *  the organiser's behalf — for onboarding when the owner isn't ready
 *  to self-serve at /org/[orgId]/staff. The PIN is set here, by the
 *  person doing the onboarding, and should be handed over in person or
 *  by phone, never SMS/email. */
export async function actionAddOrgStaff(
  orgId: string, input: { name: string; pin: string; role: 'ADMIN' | 'MANAGER' | 'SCANNER' },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    const pinHash = await hashPin(input.pin);
    await createTicketOrgStaff(ctx, orgId, { name: input.name, pinHash, role: input.role });
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That staff member wasn't added. Please try again.") };
  }
}

export async function actionSetOrgStaffActive(orgId: string, staffId: string, active: boolean): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setTicketOrgStaffActive(ctx, staffId, active);
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
  }
}
