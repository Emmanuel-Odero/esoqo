'use server';
import { revalidatePath } from 'next/cache';
import {
  createOwnGroup, inviteMember, setMemberRole, removeMember,
  createProposal, castProposalVote,
  createGroupProject, declareProjectContribution, confirmProjectContribution,
  requestProjectWithdrawal, voteProjectWithdrawal,
  applyForBusinessHandle, confirmBusinessEsoqoHandle,
  sniff, makeStorageKey, safeName, sha256, putObject, MAX_BYTES,
} from '@esoqo/db';
import { sendSms, sendEmail } from '@esoqo/auth';
import {
  createOwnGroupSchema, inviteMemberSchema, setMemberRoleSchema, removeMemberSchema, toSafeErrorMessage,
  groupInviteSms,
} from '@esoqo/domain';
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
 * happens here, not in the DAL — @esoqo/db can't import @esoqo/auth
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
    const { notify, orgName, joinFeeKes, inviterName } = await inviteMember(
      ctx, parsed.data.orgId,
      { msisdn: parsed.data.msisdn || undefined, email: parsed.data.email || undefined, officialName: parsed.data.officialName },
      parsed.data.role as never, parsed.data.customRole,
    );

    try {
      if (notify.channel === 'sms') {
        await sendSms(notify.to, groupInviteSms(orgName, { joinFeeKes, inviterName: inviterName ?? undefined }), 'group-invite');
      } else {
        const by = inviterName ? `${inviterName} has invited you` : "You've been invited";
        await sendEmail(
          notify.to, `You've been invited to ${orgName} on Esoqo`,
          `${by} to join ${orgName}, a savings group on Esoqo.\n\n`
          + (joinFeeKes > 0
            ? `This group asks for a one-time KES ${joinFeeKes.toLocaleString('en-KE')} join fee, payable once you're signed in.\n\n`
            : '')
          + 'Esoqo accounts sign in with a phone number, not this email — once one is added to your record '
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

export async function actionCreateProposal(input: {
  orgId: string; kind: 'ADD_MEMBER' | 'REMOVE_MEMBER';
  targetPersonId?: string; targetMsisdn?: string; targetName?: string;
}) {
  try {
    const ctx = await requireSubject();
    await createProposal(ctx, input);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCastProposalVote(proposalId: string, decision: 'APPROVE' | 'REJECT') {
  try {
    const ctx = await requireSubject();
    const result = await castProposalVote(ctx, proposalId, decision);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: result };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateProject(
  orgId: string, title: string, purpose: string | undefined, targetKes: number | undefined, signerIds: string[],
) {
  try {
    const ctx = await requireSubject();
    await createGroupProject(ctx, { orgId, title, purpose, targetKes, signerIds });
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionDeclareProjectContribution(projectId: string, amountKes: number) {
  try {
    const ctx = await requireSubject();
    await declareProjectContribution(ctx, projectId, { amountKes });
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionConfirmProjectContribution(contributionId: string) {
  try {
    const ctx = await requireSubject();
    await confirmProjectContribution(ctx, contributionId);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionRequestProjectWithdrawal(projectId: string, amountKes: number, purpose: string, payeeName: string) {
  try {
    const ctx = await requireSubject();
    await requestProjectWithdrawal(ctx, projectId, { amountKes, purpose, payeeName });
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionVoteProjectWithdrawal(withdrawalId: string, decision: 'APPROVE' | 'REJECT') {
  try {
    const ctx = await requireSubject();
    const result = await voteProjectWithdrawal(ctx, withdrawalId, decision);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: result };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

/**
 * An officer applying for this org's own esoqo ID handle — e.g. a shop
 * wanting its exact trading name rather than the random mnemonic every
 * org otherwise gets. Documents go up the same way the join wizard's ID
 * photos do (sniff → storage key → put → hash), then hand off to
 * applyForBusinessHandle, which is what actually checks the caller is
 * entitled to act for this org (see assertBusinessOfficer).
 */
export async function actionApplyForOrgHandle(form: FormData) {
  try {
    const ctx = await requireSubject();
    const orgId = String(form.get('orgId') ?? '');
    if (!orgId) return { ok: false as const, error: 'Missing organisation' };

    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return { ok: false as const, error: 'Attach at least one document' };

    const documents = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) return { ok: false as const, error: `${file.name} is larger than 10 MB` };
      const buf = Buffer.from(await file.arrayBuffer());
      const check = sniff(buf, file.type, file.name);
      if (!check.ok || !check.mime) return { ok: false as const, error: check.reason ?? `We can't accept ${file.name}` };

      const storageKey = makeStorageKey(check.mime);
      await putObject(storageKey, buf);
      documents.push({
        title: file.name.slice(0, 160),
        kind: 'HANDLE_APPLICATION_EVIDENCE',
        storageKey,
        originalName: safeName(file.name),
        mimeType: check.mime,
        sizeBytes: buf.length,
        sha256: sha256(buf),
      });
    }

    await applyForBusinessHandle(ctx, orgId, documents);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

/** Reserves whichever candidate the handle panel showed — see
 *  confirmBusinessEsoqoHandle for the re-check-everything shape. */
export async function actionConfirmOrgHandle(orgId: string, handle: string) {
  try {
    const ctx = await requireSubject();
    const paymentId = await confirmBusinessEsoqoHandle(ctx, orgId, handle);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: { code: paymentId.code } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
