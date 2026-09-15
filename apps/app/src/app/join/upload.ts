'use server';

import { headers } from 'next/headers';
import {
  createDocument, listDocumentsForRegistration, deleteDocument,
  declarePayment, deferPayment,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
  type Ctx,
} from '@esoqo/db';
import { toSafeErrorMessage, clientIpFrom } from '@esoqo/domain';
import { ownsRegistration } from './ownership';

/**
 * Upload and payment declaration.
 *
 * Upload is the largest attack surface here, so nothing about the file is
 * trusted: the declared MIME is ignored in favour of magic bytes, the
 * filename never becomes a path, and the size is checked before a byte
 * touches storage. All of that lives in @esoqo/db/storage — this action
 * only marshals.
 */

async function joinCtx(): Promise<Ctx> {
  const h = await headers();
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: ['registration.write', 'registration.read', 'document.read'],
    ip: clientIpFrom((n) => h.get(n)) ?? null,
    __verified: true,
  };
}

export type UploadResult =
  | { ok: true; doc: { id: string; title: string; kind: string; mimeType: string; sizeBytes: number } }
  | { ok: false; error: string };

export async function actionUpload(form: FormData): Promise<UploadResult> {
  try {
    const registrationId = String(form.get('registrationId') ?? '');
    const title = String(form.get('title') ?? '').trim();
    const kind = String(form.get('kind') ?? 'OTHER');
    const file = form.get('file');

    if (!registrationId) return { ok: false, error: 'Registration not found' };
    if (!(await ownsRegistration(registrationId))) return { ok: false, error: 'Registration not found' };
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

    const ctx = await joinCtx();
    const doc = await createDocument(ctx, {
      registrationId, title, kind, storageKey,
      originalName: safeName(file.name),
      mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
    });

    return {
      ok: true,
      doc: { id: doc.id, title: doc.title, kind: doc.kind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That upload didn't go through. Check your connection and try again — or skip this for now and add it later.") };
  }
}

export async function actionListDocuments(registrationId: string) {
  if (!(await ownsRegistration(registrationId))) return [];
  const ctx = await joinCtx();
  const docs = await listDocumentsForRegistration(ctx, registrationId);
  return docs.map((d) => ({
    id: d.id, title: d.title, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
  }));
}

export async function actionRemoveDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await joinCtx();
    // The joiner may remove their own upload before submitting.
    await deleteDocument({ ...ctx, capabilities: [...ctx.capabilities, 'document.delete'] },
      id, 'Removed by the joiner before submitting');
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That file couldn't be removed. Please try again.") };
  }
}

/* ── payment declaration ─────────────────────────────────── */

export type PayResult = { ok: true } | { ok: false; error: string };

export async function actionDeclarePayment(
  registrationId: string,
  input: { method: 'MPESA' | 'BANK_TRANSFER' | 'CASH_TO_AGENT'; reference: string; amountKes?: number; note?: string },
): Promise<PayResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return { ok: false, error: 'Registration not found' };
    if (!input.reference?.trim()) {
      return { ok: false, error: 'Enter the transaction code from your message' };
    }
    // M-Pesa codes are 10 alphanumeric characters, e.g. SFH4K2L9QW.
    if (input.method === 'MPESA' && !/^[A-Z0-9]{8,12}$/i.test(input.reference.trim())) {
      return { ok: false, error: 'An M-Pesa code looks like SFH4K2L9QW — check the message again' };
    }
    const ctx = await joinCtx();
    await declarePayment(ctx, registrationId, {
      method: input.method,
      reference: input.reference,
      amountKes: input.amountKes,
      note: input.note,
    });
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, 'We could not save that payment. Check the details and try again.') };
  }
}

export async function actionDeferPayment(registrationId: string): Promise<PayResult> {
  try {
    if (!(await ownsRegistration(registrationId))) return { ok: false, error: 'Registration not found' };
    const ctx = await joinCtx();
    await deferPayment(ctx, registrationId);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save that choice' };
  }
}
