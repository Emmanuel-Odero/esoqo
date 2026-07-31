'use server';
import { revalidatePath } from 'next/cache';
import {
  updateRegistration, voidRegistration, restoreRegistration,
  createRegistrationForPerson, getRegistrationDetail,
  createDocument, listDocumentsForRegistration,
  declarePayment, recordPayment, assignUserPin,
  assignPersonToGroup, searchGroupsForStaff,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
} from '@esoko/db';
import { hashPin, generateTempPin } from '@esoko/auth';
import { toSafeErrorMessage } from '@esoko/domain';

type PayMethod = 'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT';
export interface PaymentInput {
  method: PayMethod; reference: string; amountKes?: number; note?: string;
}
import { requireStaff } from '@/lib/session';

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): Result<never> {
  console.error(e);
  return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again — if it keeps happening, check the record hasn't been voided or completed in the meantime.") };
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

/**
 * Staff recording what a registrant paid outside the app — cash to an
 * agent, a bank transfer, an M-Pesa code read off a receipt. This is the
 * same DECLARED state a self-service declaration produces, so it enters
 * the same dual-control sign-off queue on the Payments page rather than
 * skipping it.
 */
export async function actionRecordPayment(id: string, input: PaymentInput): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!ctx.capabilities.includes('*') && !ctx.capabilities.includes('payment.record')) {
      return { ok: false, error: 'You do not hold permission to record payments' };
    }
    if (!input.reference.trim()) return { ok: false, error: 'Enter a reference' };
    await declarePayment(ctx, id, {
      method: input.method, reference: input.reference, amountKes: input.amountKes, note: input.note,
    });
    revalidatePath('/registrations');
    revalidatePath('/payments');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** Amends a payment that was recorded wrong, before it is settled. */
export async function actionAmendPayment(paymentId: string, input: PaymentInput & { amountKes: number }): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!input.reference.trim()) return { ok: false, error: 'Enter a reference' };
    await recordPayment(ctx, paymentId, {
      method: input.method, reference: input.reference, amountKes: input.amountKes, note: input.note,
    });
    revalidatePath('/registrations');
    revalidatePath('/payments');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** Assigns (or resets) a login PIN for the person this registration became.
 *  The temp PIN is returned once, shown once, never stored in plaintext. */
export async function actionAssignUserPin(personId: string): Promise<Result<{ tempPin: string }>> {
  try {
    const ctx = await requireStaff();
    const tempPin = generateTempPin();
    await assignUserPin(ctx, personId, await hashPin(tempPin));
    revalidatePath('/registrations');
    return { ok: true, data: { tempPin } };
  } catch (e) { return fail(e); }
}

/** Lean group search for staff, used by the "assign to group" picker. */
export async function actionSearchGroupsForStaff(q: string) {
  const ctx = await requireStaff();
  return searchGroupsForStaff(ctx, q);
}

/** Assigns (or moves, exiting any other active membership) a completed
 *  registration's person into a group. */
export async function actionAssignToGroup(personId: string, orgPartyId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await assignPersonToGroup(ctx, personId, orgPartyId);
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
  ussdSetupChoice?: 'now' | 'later';
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

export type UploadResult =
  | { ok: true; doc: { id: string; title: string; kind: string; mimeType: string; sizeBytes: number } }
  | { ok: false; error: string };

export async function actionUploadWalkInDocument(form: FormData): Promise<UploadResult> {
  try {
    const ctx = await requireStaff();
    const registrationId = String(form.get('registrationId') ?? '');
    const title = String(form.get('title') ?? '').trim();
    const kind = String(form.get('kind') ?? 'OTHER');
    const file = form.get('file');

    if (!registrationId) return { ok: false, error: 'Registration not found' };
    if (!title) return { ok: false, error: 'Give the document a title' };
    if (!(file instanceof File)) return { ok: false, error: 'No file was attached' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'That file is larger than 10 MB' };

    const buf = Buffer.from(await file.arrayBuffer());
    const check = sniff(buf, file.type, file.name);
    if (!check.ok || !check.mime) {
      return { ok: false, error: check.reason ?? 'We cannot accept that file' };
    }

    const storageKey = makeStorageKey(check.mime);
    await putObject(storageKey, buf);

    const doc = await createDocument(ctx, {
      registrationId, title, kind, storageKey,
      originalName: safeName(file.name),
      mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
    });

    revalidatePath('/registrations');
    return {
      ok: true,
      doc: { id: doc.id, title: doc.title, kind: doc.kind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That upload didn't go through. Check the file and try again.") };
  }
}

export async function actionListWalkInDocuments(registrationId: string) {
  const ctx = await requireStaff();
  const docs = await listDocumentsForRegistration(ctx, registrationId);
  return docs.map((d) => ({
    id: d.id, title: d.title, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
  }));
}

export async function actionRemoveWalkInDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireStaff();
    const { deleteDocument } = await import('@esoko/db');
    await deleteDocument(ctx, id, 'Removed by staff during walk-in');
    revalidatePath('/registrations');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That file couldn't be removed. Please try again.") };
  }
}
