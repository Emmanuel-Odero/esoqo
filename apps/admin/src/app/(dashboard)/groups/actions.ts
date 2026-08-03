'use server';
import { revalidatePath } from 'next/cache';
import {
  addMember, addNewMember, setMemberRole, removeMember, searchAddablePeople, type MemberRole,
  createDocument, listDocumentsForParty,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
} from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): Result => {
  console.error(e);
  return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
};

export async function actionSearchPeople(orgPartyId: string, q: string) {
  const ctx = await requireStaff();
  const people = await searchAddablePeople(ctx, orgPartyId, q);
  return people.map((p) => ({
    id: p.id,
    name: p.person?.knownAs || p.person?.officialName || 'Unnamed',
    official: p.person?.officialName ?? '',
    county: p.county,
  }));
}

export async function actionAddMember(
  orgPartyId: string, personPartyId: string, role: MemberRole,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await addMember(ctx, orgPartyId, personPartyId, role);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionAddNewMember(
  orgPartyId: string, officialName: string, msisdn: string, role: MemberRole,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!officialName.trim()) return { ok: false, error: 'Enter a name' };
    await addNewMember(ctx, orgPartyId, { officialName, msisdn: msisdn || undefined }, role);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionSetRole(membershipId: string, role: MemberRole): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setMemberRole(ctx, membershipId, role);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionRemoveMember(membershipId: string, reason: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!reason.trim()) return { ok: false, error: 'A reason is required' };
    await removeMember(ctx, membershipId, reason);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export type UploadResult =
  | { ok: true; doc: { id: string; title: string; kind: string; mimeType: string; sizeBytes: number } }
  | { ok: false; error: string };

export async function actionUploadGroupDocument(form: FormData): Promise<UploadResult> {
  try {
    const ctx = await requireStaff();
    const partyId = String(form.get('partyId') ?? '');
    const title = String(form.get('title') ?? '').trim();
    const kind = String(form.get('kind') ?? 'OTHER');
    const file = form.get('file');

    if (!partyId) return { ok: false, error: 'Group not found' };
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
      partyId, title, kind, storageKey,
      originalName: safeName(file.name),
      mimeType: check.mime, sizeBytes: buf.length, sha256: sha256(buf),
    });

    revalidatePath('/groups');
    return {
      ok: true,
      doc: { id: doc.id, title: doc.title, kind: doc.kind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That upload didn't go through. Check the file and try again.") };
  }
}

export async function actionListGroupDocuments(partyId: string) {
  const ctx = await requireStaff();
  const docs = await listDocumentsForParty(ctx, partyId);
  return docs.map((d) => ({
    id: d.id, title: d.title, kind: d.kind, mimeType: d.mimeType,
    sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString(),
  }));
}
