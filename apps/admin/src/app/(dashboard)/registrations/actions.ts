'use server';
import { revalidatePath } from 'next/cache';
import {
  updateRegistration, voidRegistration, restoreRegistration,
  createRegistrationForPerson, getRegistrationDetail,
  createDocument, listDocumentsForRegistration,
  declarePayment, recordPayment, assignUserPin,
  assignPersonToGroup, setRegistrationGroupIntent, searchGroupsForStaff,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
  saveNationalIdRecord, getDecryptedNationalId, confirmNationalId,
} from '@esoqo/db';
import { hashPin, generateTempPin } from '@esoqo/auth';
import { toSafeErrorMessage } from '@esoqo/domain';
import { tellThemTheyWereAdded } from '../groups/actions';

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
    const notice = await assignPersonToGroup(ctx, personId, orgPartyId);
    await tellThemTheyWereAdded(notice);
    revalidatePath('/registrations');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** The not-yet-complete counterpart — no Party exists yet to hang a
 *  real Membership off, so this records the intent on the registration
 *  row itself; completeRegistration links it into a real Membership
 *  automatically once the registrant finishes. Gated by
 *  membership.write only, not registration.write — see
 *  setRegistrationGroupIntent's own comment for why that distinction
 *  is the whole point of this action existing separately. */
export async function actionAssignGroupIntent(registrationId: string, orgPartyId: string, orgName: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setRegistrationGroupIntent(ctx, registrationId, orgPartyId, orgName);
    revalidatePath('/registrations');
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/** Walk-ins, phone calls, agent capture. */
export async function actionCreateWalkIn(input: {
  joiningAs: 'me' | 'group' | 'biz';
  officialName: string; knownAs?: string;
  firstName?: string; middleName?: string; surname?: string; dateOfBirth?: Date;
  msisdn?: string; email?: string;
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
    const { deleteDocument } = await import('@esoqo/db');
    await deleteDocument(ctx, id, 'Removed by staff during walk-in');
    revalidatePath('/registrations');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That file couldn't be removed. Please try again.") };
  }
}

/**
 * Staff-initiated DPA erasure — used when a data subject contacts Esoqo
 * by email, USSD or phone to request deletion and ops staff act on it.
 *
 * Requires the `party.erase` capability, which is granted only to the
 * Data Protection Officer role and superadmin (*). The capability check
 * is enforced inside erasePartyData itself (requireCapability), so even
 * if the server action is called directly the DAL refuses.
 *
 * Erases the party identified by `partyId`, not by registration id —
 * a party may have multiple registrations, and the erasure is of the
 * person, not one filing. The reason is mandatory here: this is a
 * staff action with an explicit audit obligation.
 */
export async function actionEraseParty(
  partyId: string,
  reason: string,
): Promise<{ ok: true; erasedAt: string } | { ok: false; error: string }> {
  if (!reason.trim()) {
    return { ok: false, error: 'A reason is required for staff-initiated erasure.' };
  }
  try {
    const ctx = await requireStaff();
    const { erasePartyData } = await import('@esoqo/db');
    const result = await erasePartyData(ctx, partyId, reason.trim());
    revalidatePath('/registrations');
    return { ok: true, erasedAt: result.erasedAt.toISOString() };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, 'Erasure failed. Confirm you hold the party.erase capability and the record is not already erased.') };
  }
}

/* ── national ID capture (manual entry) ──────────────────────────
 *
 * Party-scoped, not registration-scoped — unlike WalkIn's document
 * uploads, this only ever applies once a registration has completed
 * and a real Person exists, since NationalIdRecord hangs off Person.
 * No OCR here: front/back go through the same upload pipeline as any
 * other document, and staff type what the card says — see national-id.ts
 * for why, and for the follow-up this defers to.
 */

export async function actionUploadNationalIdImage(form: FormData): Promise<UploadResult> {
  try {
    const ctx = await requireStaff();
    const partyId = String(form.get('partyId') ?? '');
    const side = String(form.get('side') ?? '');
    const file = form.get('file');

    if (!partyId) return { ok: false, error: 'Person not found' };
    if (side !== 'front' && side !== 'back') return { ok: false, error: 'Unknown side' };
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
      partyId,
      title: side === 'front' ? 'National ID (front)' : 'National ID (back)',
      kind: side === 'front' ? 'NATIONAL_ID_FRONT' : 'NATIONAL_ID_BACK',
      storageKey,
      originalName: safeName(file.name),
      mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
    });

    return {
      ok: true,
      doc: { id: doc.id, title: doc.title, kind: doc.kind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That upload didn't go through. Check the file and try again.") };
  }
}

export interface SaveNationalIdInput {
  idNumber: string; serialNumber?: string; sex?: string;
  districtOfBirth?: string; dateOfIssue?: string;
  frontDocumentId?: string; backDocumentId?: string;
}

export async function actionSaveNationalId(
  partyId: string, input: SaveNationalIdInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireStaff();
    await saveNationalIdRecord(ctx, partyId, {
      ...input,
      dateOfIssue: input.dateOfIssue ? new Date(input.dateOfIssue) : undefined,
    });
    revalidatePath('/registrations');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That couldn't be saved. Check the fields and try again.") };
  }
}

export async function actionGetNationalId(partyId: string) {
  try {
    const ctx = await requireStaff();
    const record = await getDecryptedNationalId(ctx, partyId);
    if (!record) return { ok: true as const, record: null };
    return {
      ok: true as const,
      record: { ...record, dateOfIssue: record.dateOfIssue?.toISOString().slice(0, 10) ?? null, verifiedAt: record.verifiedAt?.toISOString() ?? null },
    };
  } catch (e) {
    return { ok: false as const, error: toSafeErrorMessage(e, "Couldn't load the national ID record.") };
  }
}

export async function actionConfirmNationalId(
  partyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireStaff();
    await confirmNationalId(ctx, partyId);
    revalidatePath('/registrations');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "Couldn't confirm this national ID.") };
  }
}
