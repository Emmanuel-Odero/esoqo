'use server';
import { revalidatePath } from 'next/cache';
import {
  updateRegistration, voidRegistration, restoreRegistration,
  createRegistrationForPerson, getRegistrationDetail,
} from '@esoko/db';
import { requireStaff } from '@/lib/session';

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): Result<never> {
  return { ok: false, error: e instanceof Error ? e.message : 'That did not work' };
}

export async function actionGetDetail(id: string) {
  const ctx = await requireStaff();
  const d = await getRegistrationDetail(ctx, id);
  if (!d) return null;
  // Dates and Decimals do not survive the RSC boundary intact.
  return {
    ...d,
    startedAt: d.startedAt.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    voidedAt: d.voidedAt?.toISOString() ?? null,
    msisdnVerifiedAt: d.msisdnVerifiedAt?.toISOString() ?? null,
    payment: d.payment
      ? {
          ...d.payment,
          declaredAt: d.payment.declaredAt?.toISOString() ?? null,
          confirmedAt: d.payment.confirmedAt?.toISOString() ?? null,
          createdAt: d.payment.createdAt.toISOString(),
          updatedAt: d.payment.updatedAt.toISOString(),
          approvals: d.payment.approvals.map((a) => ({
            id: a.id, decision: a.decision, note: a.note,
            signedAt: a.signedAt.toISOString(), approver: a.approver,
          })),
        }
      : null,
    documents: d.documents.map((x) => ({
      id: x.id, title: x.title, kind: x.kind, mimeType: x.mimeType,
      sizeBytes: x.sizeBytes, status: x.status, uploadedAt: x.uploadedAt.toISOString(),
    })),
  };
}

export async function actionEdit(id: string, input: Record<string, unknown>): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateRegistration(ctx, id, input);
    revalidatePath('/registrations');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionVoid(id: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await voidRegistration(ctx, id, reason);
    revalidatePath('/registrations');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

export async function actionRestore(id: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await restoreRegistration(ctx, id);
    revalidatePath('/registrations');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** Walk-ins, phone calls, agent capture. */
export async function actionCreateWalkIn(input: {
  joiningAs: 'me' | 'group' | 'biz';
  officialName: string; knownAs?: string; msisdn?: string; email?: string;
  county: string; ward?: string; workRaw?: string;
  orgName?: string; orgKnownAs?: string; orgRole?: string; memberCount?: number;
  hasRegisteredBusiness?: string; registrationNo?: string;
  belongsToGroup?: string; groupName?: string; hasKraPin?: string;
  wantsPriceSms?: boolean; wantsReceiptSms?: boolean; wantsExpirySms?: boolean;
  ussdSetupChoice?: string;
}): Promise<Result<{ id: string }>> {
  try {
    const ctx = await requireStaff();
    const reg = await createRegistrationForPerson(ctx, {
      ...input,
      joiningAs: input.joiningAs,
    });
    revalidatePath('/registrations');
    return { ok: true, data: { id: reg.id } };
  } catch (e) { return fail(e); }
}
