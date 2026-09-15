'use server';
import { revalidatePath } from 'next/cache';
import {
  declareContribution, confirmContribution, requestWithdrawal, signWithdrawal,
  createJoinFeePayment, setTreasuryPolicy,
  getContributionNotifyDetail, activeMemberMsisdns,
} from '@esoqo/db';
import { sendSms } from '@esoqo/auth';
import {
  declareContributionSchema, requestWithdrawalSchema, signWithdrawalSchema,
  createJoinFeePaymentSchema, setTreasuryPolicySchema, toSafeErrorMessage,
  contributionDeclaredSms, contributionConfirmedSms,
} from '@esoqo/domain';
import { requireSubject } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again — if it keeps happening, dial *483*77# and choose 4.";

/**
 * Both contribution texts are best-effort, and deliberately sent after
 * the write rather than inside it: the money has already moved, and a
 * silent SMS gateway must not turn a confirmed contribution into an
 * error the member sees. The Go API does exactly this for the same two
 * events (see notifyContributionConfirmed in handlers_treasury.go) —
 * this is the web's half, which until now sent nothing at all.
 */
async function notifyContributionDeclared(contributionId: string, method: string) {
  try {
    const detail = await getContributionNotifyDetail(contributionId);
    if (!detail?.contributorMsisdn) return;
    await sendSms(
      detail.contributorMsisdn,
      contributionDeclaredSms({ amountKes: detail.amountKes, method, reference: detail.reference }),
      'treasury-contribution',
    );
  } catch (e) {
    console.error('[treasury] declared notification failed', e);
  }
}

/**
 * Fans out to every active member, not just the contributor — a
 * balance only one person can see is the problem this whole feature
 * exists to fix.
 */
async function notifyContributionConfirmed(contributionId: string) {
  try {
    const detail = await getContributionNotifyDetail(contributionId);
    if (!detail) return;
    const message = contributionConfirmedSms({
      amountKes: detail.amountKes,
      contributorName: detail.contributorName,
      orgName: detail.orgName,
      newBalanceKes: detail.newBalanceKes,
      reference: detail.reference,
    });
    const recipients = await activeMemberMsisdns(detail.orgId);
    await Promise.all(recipients.map((to) =>
      sendSms(to, message, 'treasury-contribution').catch((e) => {
        // One bad number must not swallow the rest of the fan-out.
        console.error('[treasury] confirmed notification failed for one member', e);
      })));
  } catch (e) {
    console.error('[treasury] confirmed notification failed', e);
  }
}

export async function actionDeclareContribution(raw: unknown) {
  const parsed = declareContributionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const contribution = await declareContribution(ctx, parsed.data);
    await notifyContributionDeclared(contribution.id, parsed.data.method ?? 'declared');
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionConfirmContribution(contributionId: string) {
  try {
    const ctx = await requireSubject();
    const { alreadyConfirmed } = await confirmContribution(ctx, contributionId);
    // Re-texting the whole group every time an officer taps a stale
    // button is exactly the kind of noise that gets a sender ID blocked.
    if (!alreadyConfirmed) await notifyContributionConfirmed(contributionId);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionRequestWithdrawal(raw: unknown) {
  const parsed = requestWithdrawalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const withdrawal = await requestWithdrawal(ctx, parsed.data);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const, data: { standbyOpensAt: withdrawal.standbyOpensAt.toISOString() } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateJoinFeePayment(raw: unknown) {
  const parsed = createJoinFeePaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await createJoinFeePayment(ctx, parsed.data.orgId, { method: parsed.data.method, reference: parsed.data.reference });
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSetTreasuryPolicy(raw: unknown) {
  const parsed = setTreasuryPolicySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const { orgId, ...input } = parsed.data;
    await setTreasuryPolicy(ctx, orgId, input);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSignWithdrawal(raw: unknown) {
  const parsed = signWithdrawalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check your PIN' };
  try {
    const ctx = await requireSubject();
    await signWithdrawal(ctx, parsed.data);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return {
      ok: false as const,
      error: toSafeErrorMessage(e, "That signature didn't go through. Please try again."),
    };
  }
}
