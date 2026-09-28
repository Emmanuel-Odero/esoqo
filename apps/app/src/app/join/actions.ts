'use server';

import { headers } from 'next/headers';
import {
  startRegistration, updateRegistration, markMsisdnVerified, completeRegistration,
  createDocument, saveNationalIdRecord, issueEsoqoPaymentId, publicJoinCtx,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
} from '@esoqo/db';
import {
  issueOtp, verifyOtp, OtpError, checkRateLimit, RateLimitError, capabilitiesForRole,
  consumeInviteToken,
} from '@esoqo/auth';
import { msisdnSchema, otpCodeSchema, clientIpFrom, toSafeErrorMessage } from '@esoqo/domain';
import type { Ctx } from '@esoqo/db';

/**
 * The public self-serve signup flow — /join. Unlike apps/admin's
 * WalkInFlow (staff creating a registration on someone else's behalf),
 * every action here runs as the visitor themselves, before they have a
 * session: publicJoinCtx (packages/db/src/capabilities.ts) is the
 * least-privilege stand-in for that, scoped to exactly the
 * registration.* actions this flow needs and nothing else.
 *
 * Phone verification reuses issueOtp/verifyOtp (packages/auth/src/otp.ts)
 * directly — the same primitives the rest of the product's PIN_RESET
 * flow is built on, just with purpose REGISTRATION, which the schema
 * already defines but nothing previously called with.
 *
 * PIN setup is NOT handled here — after completeJoin succeeds, the
 * person is sent to /signin/set-pin, the existing self-serve PIN flow,
 * rather than duplicating credential-setting logic that already exists,
 * is already tested, and already signs the person in at the end.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom((n) => h.get(n));
}

export interface JoinDetails {
  firstName: string;
  middleName?: string;
  surname: string;
  dateOfBirth?: string;
  sex?: string;
  county: string;
  ward?: string;
  msisdn: string;
  email?: string;
  idNumber?: string;
  serialNumber?: string;
  districtOfBirth?: string;
  dateOfIssue?: string;
}

/**
 * Starts (or resumes) a registration and writes every detail-step field
 * in one call — the wizard collects it all client-side before this ever
 * runs, so there's no reason to split it into per-field round trips the
 * way the admin table's inline-edit does.
 */
export async function actionStartJoin(
  registrationId: string | null, details: JoinDetails,
): Promise<ActionResult<{ registrationId: string }>> {
  const msisdn = msisdnSchema.safeParse(details.msisdn);
  if (!msisdn.success) return { ok: false, error: msisdn.error.issues[0]?.message ?? 'Enter a valid phone number', field: 'msisdn' };
  if (!details.firstName.trim() || !details.surname.trim()) {
    return { ok: false, error: 'First name and surname are required', field: 'firstName' };
  }

  const ctx = publicJoinCtx(await clientIp());
  try {
    const officialName = [details.firstName, details.middleName, details.surname].filter(Boolean).join(' ');
    let id = registrationId;
    if (!id) {
      const reg = await startRegistration(ctx, {
        joiningAs: 'me', officialName, path: 'SELF_WEB', ip: await clientIp(),
      });
      id = reg.id;
    }
    await updateRegistration(ctx, id, {
      officialName,
      firstName: details.firstName.trim(),
      middleName: details.middleName?.trim() || undefined,
      surname: details.surname.trim(),
      dateOfBirth: details.dateOfBirth ? new Date(details.dateOfBirth) : undefined,
      county: details.county,
      ward: details.ward || undefined,
      msisdn: msisdn.data,
      email: details.email || undefined,
    });
    return { ok: true, data: { registrationId: id } };
  } catch (e) {
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Check your details and try again.") };
  }
}

/** Front/back ID photo upload — registrationId-scoped, exactly like
 *  admin's actionUploadWalkInDocument, just running as the visitor. */
export async function actionUploadJoinDocument(form: FormData): Promise<
  { ok: true; docId: string } | { ok: false; error: string }
> {
  try {
    const ctx = publicJoinCtx(await clientIp());
    const registrationId = String(form.get('registrationId') ?? '');
    const side = String(form.get('side') ?? '');
    const file = form.get('file');

    if (!registrationId) return { ok: false, error: 'Start the form first' };
    if (side !== 'front' && side !== 'back') return { ok: false, error: 'Unknown side' };
    if (!(file instanceof File)) return { ok: false, error: 'No photo was attached' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'That photo is too large' };

    const buf = Buffer.from(await file.arrayBuffer());
    const check = sniff(buf, file.type, file.name);
    if (!check.ok || !check.mime) return { ok: false, error: check.reason ?? "We couldn't accept that photo" };

    const storageKey = makeStorageKey(check.mime);
    await putObject(storageKey, buf);
    const doc = await createDocument(ctx, {
      registrationId,
      title: side === 'front' ? 'National ID (front)' : 'National ID (back)',
      kind: side === 'front' ? 'NATIONAL_ID_FRONT' : 'NATIONAL_ID_BACK',
      storageKey, originalName: safeName(file.name),
      mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
    });
    return { ok: true, docId: doc.id };
  } catch (e) {
    return { ok: false, error: toSafeErrorMessage(e, "That photo didn't upload. Try again.") };
  }
}

export async function actionSendJoinOtp(msisdnRaw: string): Promise<ActionResult> {
  const parsed = msisdnSchema.safeParse(msisdnRaw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid number' };

  try {
    await checkRateLimit(`join-otp:${await clientIp()}`, 10, 300);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
    throw e;
  }

  try {
    await issueOtp(parsed.data, 'REGISTRATION', await clientIp());
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message };
    return { ok: false, error: toSafeErrorMessage(e, "Couldn't send a code. Try again.") };
  }
}

export async function actionVerifyJoinOtp(
  registrationId: string, msisdnRaw: string, codeRaw: string,
): Promise<ActionResult> {
  const msisdn = msisdnSchema.safeParse(msisdnRaw);
  const code = otpCodeSchema.safeParse(codeRaw);
  if (!msisdn.success) return { ok: false, error: 'Enter a valid phone number' };
  if (!code.success) return { ok: false, error: code.error.issues[0]?.message ?? 'Enter the code' };

  try {
    await verifyOtp(msisdn.data, 'REGISTRATION', code.data);
  } catch (e) {
    if (e instanceof OtpError) return { ok: false, error: e.message, field: 'code' };
    throw e;
  }

  const ctx = publicJoinCtx(await clientIp());
  try {
    await markMsisdnVerified(ctx, registrationId);
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: toSafeErrorMessage(e, "Couldn't confirm that. Try again.") };
  }
}

export interface JoinCompleteResult {
  esoqoId: string;
}

/**
 * Finishes the registration and immediately activates the new person's
 * esoqo ID and national ID record. Builds a real SUBJECT ctx for the
 * party completeRegistration just created — the same shape a signed-in
 * session produces (see ctxFromToken, packages/auth/src/session.ts) —
 * rather than reusing publicJoinCtx past this point, since everything
 * after this belongs to that specific person, not to "anyone filling in
 * the join form".
 */
export async function actionCompleteJoin(
  registrationId: string, idDetails: {
    idNumber?: string; serialNumber?: string; sex?: string;
    districtOfBirth?: string; dateOfIssue?: string;
    frontDocumentId?: string; backDocumentId?: string;
    /** Present when this signup came from a chama invite link. Spent on
     *  success so the link stops prefilling a form for an account that
     *  now exists. Nothing about the membership depends on it: the group
     *  is joined to the Person completeRegistration matched by phone
     *  number, which the invite created before the SMS ever went out. */
    inviteToken?: string;
  },
): Promise<ActionResult<JoinCompleteResult>> {
  const ip = await clientIp();
  const joinCtx = publicJoinCtx(ip);

  try {
    const { partyId } = await completeRegistration(joinCtx, registrationId);
    const subjectCtx: Ctx = {
      actorType: 'SUBJECT', actorId: partyId, partyId,
      capabilities: capabilitiesForRole('SUBJECT'), ip, __verified: true,
    };

    if (idDetails.idNumber) {
      await saveNationalIdRecord(subjectCtx, partyId, {
        idNumber: idDetails.idNumber,
        serialNumber: idDetails.serialNumber,
        sex: idDetails.sex,
        districtOfBirth: idDetails.districtOfBirth,
        dateOfIssue: idDetails.dateOfIssue ? new Date(idDetails.dateOfIssue) : undefined,
        frontDocumentId: idDetails.frontDocumentId,
        backDocumentId: idDetails.backDocumentId,
      });
    }

    const esoqoPaymentId = await issueEsoqoPaymentId(subjectCtx);
    await consumeInviteToken(idDetails.inviteToken);
    return { ok: true, data: { esoqoId: esoqoPaymentId.code } };
  } catch (e) {
    return { ok: false, error: toSafeErrorMessage(e, "Couldn't finish your signup. Please try again.") };
  }
}
