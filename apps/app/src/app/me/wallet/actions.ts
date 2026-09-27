'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { createVoucherSchema, loadVoucherSchema } from '@esoqo/domain';
import {
  createWalletTopUp, attachWalletTopUpCheckoutRequestId, confirmWalletTopUp, failWalletTopUpById,
  WalletTopUpError,
} from '@esoqo/db';
import { initiateStkPush, MpesaError } from '@esoqo/payments';
import { goFetch } from '@/lib/ticketing';
import { requireSubject } from '@/lib/session';

async function token() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? '';
}

// ── wallet top-up ──────────────────────────────────────────────────

export type TopUpWalletResult =
  | { status: 'STARTED'; topUpId: string; alreadyConfirmed: boolean }
  | { status: 'REJECTED'; message: string }
  | { status: 'ERROR'; message: string };

/**
 * Same order as /pay's actionStartPayment, for the same reason: the row
 * is written before the STK push is attempted, so a crash in between
 * cannot lose money the person believes they sent.
 */
export async function actionTopUpWallet(input: { amountKes: number; msisdn: string }): Promise<TopUpWalletResult> {
  const ctx = await requireSubject();
  let topUpId: string | null = null;
  try {
    const topUp = await createWalletTopUp(ctx, input);
    topUpId = topUp.id;

    const push = await initiateStkPush({
      msisdn: topUp.msisdn,
      amountKes: Number(topUp.amountKes),
      accountReference: 'ESOQO WALLET',
      description: 'Wallet top-up',
    });
    await attachWalletTopUpCheckoutRequestId(topUp.id, push.checkoutRequestId);

    if (!push.autoConfirmed) {
      return { status: 'STARTED', topUpId: topUp.id, alreadyConfirmed: false };
    }
    await confirmWalletTopUp(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    revalidatePath('/me/wallet');
    revalidatePath('/me');
    return { status: 'STARTED', topUpId: topUp.id, alreadyConfirmed: true };
  } catch (e: unknown) {
    if (e instanceof WalletTopUpError) return { status: 'REJECTED', message: e.message };
    if (e instanceof MpesaError) {
      if (topUpId) {
        await failWalletTopUpById(topUpId, `M-Pesa declined to send the prompt: ${e.message}`).catch(() => {});
      }
      return { status: 'REJECTED', message: e.message };
    }
    console.error('wallet top-up failed', e, { topUpId });
    return { status: 'ERROR', message: 'Something went wrong. Try again in a moment.' };
  }
}

// ── vouchers & loyalty (moved from /me/vouchers, unchanged logic) ───

export async function actionCreateVoucher(raw: unknown) {
  const parsed = createVoucherSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  try {
    const t = await token();
    const res = await goFetch('/v1/vouchers', t, { method: 'POST', body: JSON.stringify(parsed.data) });
    revalidatePath('/me/wallet');
    return { ok: true as const, data: (res as { voucher: unknown }).voucher };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not create voucher.' };
  }
}

export async function actionLoadVoucher(id: string, raw: unknown) {
  const parsed = loadVoucherSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  try {
    const t = await token();
    await goFetch(`/v1/vouchers/${id}/load`, t, { method: 'POST', body: JSON.stringify(parsed.data) });
    revalidatePath('/me/wallet');
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not top up.' };
  }
}

// ── bills ─────────────────────────────────────────────────────────

export async function actionCreateBill(raw: {
  label: string; category: string; cycle: string; nextDueAt: string;
  amountKes?: number; reminderDaysBefore?: number;
}) {
  try {
    const t = await token();
    await goFetch('/v1/me/bills', t, {
      method: 'POST',
      body: JSON.stringify({
        label: raw.label,
        category: raw.category,
        cycle: raw.cycle,
        nextDueAt: raw.nextDueAt,
        amountKes: raw.amountKes,
        reminderDaysBefore: raw.reminderDaysBefore ?? 3,
      }),
    });
    revalidatePath('/me/wallet');
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not add this bill.' };
  }
}

export async function actionMarkBillPaid(id: string, amountKes: number) {
  try {
    const t = await token();
    await goFetch(`/v1/me/bills/${id}/pay`, t, { method: 'POST', body: JSON.stringify({ amountKes }) });
    revalidatePath('/me/wallet');
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not mark this bill paid.' };
  }
}

export async function actionArchiveBill(id: string) {
  try {
    const t = await token();
    await goFetch(`/v1/me/bills/${id}`, t, { method: 'DELETE' });
    revalidatePath('/me/wallet');
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not remove this bill.' };
  }
}
