'use server';
import { revalidatePath } from 'next/cache';
import {
  addMember, addNewMember, updateMemberPhone, setMemberRole, removeMember, searchAddablePeople, type MemberRole,
  createGroup, type OrgKind,
  createDocument, listDocumentsForParty,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
  getPartyByMsisdn, addTenant, endTenancy, setMallSlug, listTenants,
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
  orgPartyId: string, personPartyId: string, role: MemberRole, customRole?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await addMember(ctx, orgPartyId, personPartyId, role, customRole);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionAddNewMember(
  orgPartyId: string, officialName: string, msisdn: string, role: MemberRole, customRole?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!officialName.trim()) return { ok: false, error: 'Enter a name' };
    await addNewMember(ctx, orgPartyId, { officialName, msisdn: msisdn || undefined }, role, customRole);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Fix a member's phone on file — e.g. a typo'd roster number that can't
 *  be verified, which would otherwise leave the member unable to sign in
 *  and their membership invisible to them. */
export async function actionUpdateMemberPhone(membershipId: string, phone: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!phone.trim()) return { ok: false, error: 'Enter a phone number' };
    await updateMemberPhone(ctx, membershipId, phone);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export type CreateGroupResult = { ok: true; partyId: string } | { ok: false; error: string };

export async function actionCreateGroup(input: {
  kind: OrgKind; officialName: string; knownAs?: string; county: string;
  ward?: string; registrationNo?: string; memberCount?: number;
}): Promise<CreateGroupResult> {
  try {
    const ctx = await requireStaff();
    if (!input.officialName.trim()) return { ok: false, error: 'Enter a group name' };
    if (!input.county) return { ok: false, error: 'Choose a county' };
    const party = await createGroup(ctx, input);
    revalidatePath('/groups');
    return { ok: true, partyId: party.id };
  } catch (e) { return fail(e) as CreateGroupResult; }
}

export async function actionSetRole(
  membershipId: string, role: MemberRole, customRole?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setMemberRole(ctx, membershipId, role, customRole);
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

/* ── Mall tenancy ─────────────────────────────────────────────── */

/** Looks a prospective tenant up by phone — returns the enterprises the
 *  matching person can offer as a tenant (same shape a subject's own
 *  "which of my enterprises" picker would use, since a mall's tenants
 *  are Enterprises, not whole organisations). */
export async function actionFindTenantByPhone(msisdn: string) {
  const ctx = await requireStaff();
  if (!msisdn.trim()) return { ok: false as const, error: 'Enter a phone number' };
  const party = await getPartyByMsisdn(ctx, msisdn.trim());
  if (!party) return { ok: false as const, error: 'No one on Esoko has that number' };
  const enterprises = party.enterprises.map((e) => ({ id: e.id, workRaw: e.workRaw }));
  if (enterprises.length === 0) return { ok: false as const, error: 'That person has no business on file yet' };
  return { ok: true as const, enterprises };
}

export async function actionAddTenant(
  mallOrgId: string, tenantEnterpriseId: string, unitLabel?: string,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await addTenant(ctx, mallOrgId, tenantEnterpriseId, unitLabel);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionEndTenancy(tenancyId: string, reason?: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await endTenancy(ctx, tenancyId, reason);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionSetMallSlug(mallOrgId: string, slug: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setMallSlug(ctx, mallOrgId, slug.trim() || null);
    revalidatePath('/groups');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function actionListTenants(mallOrgId: string) {
  const ctx = await requireStaff();
  const tenancies = await listTenants(ctx, mallOrgId);
  return tenancies.map((t) => ({
    id: t.id,
    unitLabel: t.unitLabel,
    endedAt: t.endedAt ? t.endedAt.toISOString() : null,
    startedAt: t.startedAt.toISOString(),
    tenantWork: t.tenantEnterprise.workRaw,
    stores: t.tenantEnterprise.stores.map((s) => ({ id: s.id, name: s.name, slug: s.slug, status: s.status })),
  }));
}
