'use server';
import { revalidatePath } from 'next/cache';
import {
  declareContribution, confirmContribution, requestWithdrawal, signWithdrawal,
  createJoinFeePayment, setTreasuryPolicy,
  getContributionNotifyDetail, activeMemberMsisdns,
  getWithdrawalNotifyDetail, effectiveSignerMsisdns,
  addSignatory, setGroupSignerPermissions, removeGroupSigner,
  attachSignatoryFeeCheckoutRequestId, confirmSignatoryFeePayment, failSignatoryFeePaymentById,
  type SignerPermissions,
} from '@esoqo/db';
import { sendSms } from '@esoqo/auth';
import { initiateStkPush, MpesaError } from '@esoqo/payments';
import {
  declareContributionSchema, requestWithdrawalSchema, signWithdrawalSchema,
  createJoinFeePaymentSchema, setTreasuryPolicySchema, toSafeErrorMessage,
  contributionDeclaredSms, contributionConfirmedSms, withdrawalRequestedSms,
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

/**
 * Withdrawals used to notify nobody — a member found out money was
 * moving only by opening the treasury page and looking. Signers are the
 * one audience with something to do (sign or reject before the standby
 * window closes), so they're the one audience billed SMS; everyone else
 * finds out from the free activity feed the DAL already wrote to.
 */
async function notifyWithdrawalRequested(withdrawalId: string) {
  try {
    const detail = await getWithdrawalNotifyDetail(withdrawalId);
    if (!detail) return;
    const message = withdrawalRequestedSms({
      orgName: detail.orgName, amountKes: detail.amountKes,
      purpose: detail.purpose, requesterName: detail.requesterName,
    });
    const recipients = await effectiveSignerMsisdns(detail.orgId);
    await Promise.all(recipients.map((to) =>
      sendSms(to, message, 'treasury-withdrawal').catch((e) => {
        console.error('[treasury] withdrawal-requested notification failed for one signer', e);
      })));
  } catch (e) {
    console.error('[treasury] withdrawal-requested notification failed', e);
  }
}

export async function actionRequestWithdrawal(raw: unknown) {
  const parsed = requestWithdrawalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const withdrawal = await requestWithdrawal(ctx, parsed.data);
    await notifyWithdrawalRequested(withdrawal.id);
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

/**
 * Adding a signatory beyond the first five free ones needs real money
 * to move before the signer row exists (see addSignatory's DAL doc) —
 * same write-then-push-then-confirm order as wallet top-up and
 * business payments, for the same reason: the fee row is created first
 * so a crash between here and Safaricom can't lose track of it.
 */
export async function actionAddSignatory(
  orgId: string, personId: string, permissions: SignerPermissions, feeMethod: 'STK_NEW_SIGNER' | 'STK_OFFICER' | 'GROUP_TREASURY',
) {
  try {
    const ctx = await requireSubject();
    const result = await addSignatory(ctx, orgId, personId, permissions, feeMethod);
    if (result.status === 'ADDED') {
      revalidatePath('/me/group', 'layout');
      return { ok: true as const, data: { status: 'ADDED' as const } };
    }

    // FEE_PENDING: an STK push is needed before the row is created.
    if (!result.payerMsisdn) {
      return { ok: false as const, error: 'No phone number on file to send the M-Pesa prompt to.' };
    }
    let push;
    try {
      push = await initiateStkPush({
        msisdn: result.payerMsisdn, amountKes: 50,
        accountReference: 'ESOQO SIGNATORY', description: 'Signatory fee',
      });
    } catch (e) {
      await failSignatoryFeePaymentById(result.feeId, e instanceof MpesaError ? e.message : 'M-Pesa declined to send the prompt').catch(() => {});
      return { ok: false as const, error: e instanceof MpesaError ? e.message : FALLBACK };
    }
    await attachSignatoryFeeCheckoutRequestId(result.feeId, push.checkoutRequestId);
    if (push.autoConfirmed) {
      await confirmSignatoryFeePayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
      revalidatePath('/me/group', 'layout');
      return { ok: true as const, data: { status: 'ADDED' as const } };
    }
    return { ok: true as const, data: { status: 'FEE_PENDING' as const, msisdn: result.payerMsisdn } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSetGroupSignerPermissions(orgId: string, personId: string, permissions: Partial<SignerPermissions>) {
  try {
    const ctx = await requireSubject();
    await setGroupSignerPermissions(ctx, orgId, personId, permissions);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionRemoveGroupSigner(orgId: string, personId: string) {
  try {
    const ctx = await requireSubject();
    await removeGroupSigner(ctx, orgId, personId);
    revalidatePath('/me/group', 'layout');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
