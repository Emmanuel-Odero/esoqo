'use server';
import { revalidatePath } from 'next/cache';
import { addMember, setMemberRole, removeMember, searchAddablePeople, type MemberRole } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): Result =>
  ({ ok: false, error: e instanceof Error ? e.message : 'That did not work' });

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
