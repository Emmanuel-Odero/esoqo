'use server';
import { revalidatePath } from 'next/cache';
import {
  declareContribution, confirmContribution, requestWithdrawal, signWithdrawal,
} from '@esoko/db';
import {
  declareContributionSchema, requestWithdrawalSchema, signWithdrawalSchema, toSafeErrorMessage,
} from '@esoko/domain';
import { requireSubject } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again — if it keeps happening, dial *483*77# and choose 4.";

export async function actionDeclareContribution(raw: unknown) {
  const parsed = declareContributionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    await declareContribution(ctx, parsed.data);
    revalidatePath('/me/group/treasury');
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
    revalidatePath('/me/group/treasury');
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
    revalidatePath('/me/group/treasury');
    return { ok: true as const, data: { standbyOpensAt: withdrawal.standbyOpensAt.toISOString() } };
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
    revalidatePath('/me/group/treasury');
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return {
      ok: false as const,
      error: toSafeErrorMessage(e, "That signature didn't go through. Please try again."),
    };
  }
}
