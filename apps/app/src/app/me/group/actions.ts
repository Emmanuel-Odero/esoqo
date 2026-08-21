'use server';
import { revalidatePath } from 'next/cache';
import {
  createOwnGroup, inviteMember, setMemberRole, removeMember,
} from '@esoko/db';
import { sendSms, sendEmail } from '@esoko/auth';
import {
  createOwnGroupSchema, inviteMemberSchema, setMemberRoleSchema, removeMemberSchema, toSafeErrorMessage,
} from '@esoko/domain';
import { requireSubject } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again.";

/** /me/group's "start a group" form — see createOwnGroup in
 *  packages/db/src/dal/groups.ts for what this sets up in one step
 *  (the group, its contribution account, and the founder as its first
 *  signer). */
export async function actionCreateOwnGroup(raw: unknown) {
  const parsed = createOwnGroupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await createOwnGroup(ctx, {
      orgKind: parsed.data.orgKind as never,
      orgKindOther: parsed.data.orgKindOther || undefined,
      officialName: parsed.data.officialName,
      knownAs: parsed.data.knownAs || undefined,
      county: parsed.data.county,
      ward: parsed.data.ward || undefined,
      registrationNo: parsed.data.registrationNo || undefined,
      memberCount: parsed.data.memberCount,
    });
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

/**
 * An officer inviting someone by phone or email — see inviteMember in
 * packages/db/src/dal/groups.ts for the existing-vs-new-person branch
 * and the join-fee-aware pending status. The actual SMS/email send
 * happens here, not in the DAL — @esoko/db can't import @esoko/auth
 * (the dependency runs the other way), and this Server Action already
 * sits above both. A send failure is logged but doesn't fail the
 * invite — the membership row is the source of truth; the officer can
 * always tell the person directly if the message didn't land.
 */
export async function actionInviteMember(raw: unknown) {
  const parsed = inviteMemberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const { notify, orgName } = await inviteMember(
      ctx, parsed.data.orgId,
      { msisdn: parsed.data.msisdn || undefined, email: parsed.data.email || undefined, officialName: parsed.data.officialName },
      parsed.data.role as never, parsed.data.customRole,
    );

    try {
      if (notify.channel === 'sms') {
        await sendSms(notify.to, `You've been added to ${orgName} on Esoko. Sign in or set your PIN with this number to get started.`, 'group-invite');
      } else {
        await sendEmail(
          notify.to, `You've been invited to ${orgName} on Esoko`,
          `You've been invited to join ${orgName} on Esoko.\n\n`
          + 'Esoko accounts sign in with a phone number, not this email — once one is added to your record '
          + '(ask whoever invited you, or add it yourself once you have an account), you can sign in and set a PIN.',
        );
      }
    } catch (notifyErr) {
      console.error('[invite] notification failed', notifyErr);
    }

    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSetMemberRole(raw: unknown) {
  const parsed = setMemberRoleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await setMemberRole(ctx, parsed.data.membershipId, parsed.data.role as never, parsed.data.customRole);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionRemoveMember(raw: unknown) {
  const parsed = removeMemberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await removeMember(ctx, parsed.data.membershipId, parsed.data.reason);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
