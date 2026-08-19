'use server';
import { revalidatePath } from 'next/cache';
import {
  declareContribution, confirmContribution, requestWithdrawal, signWithdrawal,
  createJoinFeePayment, setTreasuryPolicy,
} from '@esoko/db';
import {
  declareContributionSchema, requestWithdrawalSchema, signWithdrawalSchema,
  createJoinFeePaymentSchema, setTreasuryPolicySchema, toSafeErrorMessage,
} from '@esoko/domain';
import { requireSubject } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again — if it keeps happening, dial *483*77# and choose 4.";

export async function actionDeclareContribution(raw: unknown) {
  const parsed = declareContributionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await declareContribution(ctx, parsed.data);
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
    await confirmContribution(ctx, contributionId);
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
