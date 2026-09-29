'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { createVoucherSchema, loadVoucherSchema, transferSentSms, transferReceivedSms } from '@esoqo/domain';
import {
  createWalletTopUp, attachWalletTopUpCheckoutRequestId, confirmWalletTopUp, failWalletTopUpById,
  WalletTopUpError,
  createWalletWithdrawal, attachWalletWithdrawalConversationId, confirmWalletWithdrawal,
  failWalletWithdrawalById, WalletWithdrawalError,
  createEsoqoTransfer, EsoqoTransferError,
  feeForAmount,
} from '@esoqo/db';
import { initiateStkPush, initiateB2CPayment, MpesaError } from '@esoqo/payments';
// sendSms is under the auth package's non-'server-only' subpath, same
// reason services/core's webhook imports it that way — see that file's
// own header comment.
import { sendSms } from '@esoqo/auth/sms';
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

// ── wallet withdrawal ──────────────────────────────────────────────

/** A quote only — no row written, no auth beyond being signed in. Lets
 *  the withdraw form show the fee/net-payout split before the person
 *  commits to an amount, instead of only after actionWithdrawWallet has
 *  already moved money. */
export async function actionQuoteWithdrawalFee(amountKes: number): Promise<{ feeKes: number; netPayoutKes: number } | null> {
  await requireSubject();
  const amount = Number(amountKes);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const feeKes = await feeForAmount('WALLET_WITHDRAWAL', amount);
  return { feeKes, netPayoutKes: amount - feeKes };
}

export type WithdrawWalletResult =
  | { status: 'STARTED'; withdrawalId: string; msisdn: string; feeKes: number; netPayoutKes: number; alreadyConfirmed: boolean }
  | { status: 'REJECTED'; message: string }
  | { status: 'ERROR'; message: string };

/**
 * Same order as actionTopUpWallet: the row is written (with msisdn
 * resolved server-side from the caller's own registration, never from
 * this action's input) before the B2C push is attempted, so a crash in
 * between cannot lose the record of money the person believes left their
 * wallet.
 */
export async function actionWithdrawWallet(input: { amountKes: number }): Promise<WithdrawWalletResult> {
  const ctx = await requireSubject();
  let withdrawalId: string | null = null;
  try {
    const withdrawal = await createWalletWithdrawal(ctx, input);
    withdrawalId = withdrawal.id;

    const push = await initiateB2CPayment({
      msisdn: withdrawal.msisdn,
      amountKes: Number(withdrawal.netPayoutKes),
      remarks: 'Esoqo wallet withdrawal',
    });
    await attachWalletWithdrawalConversationId(withdrawal.id, push.conversationId);

    const feeKes = Number(withdrawal.feeKes);
    const netPayoutKes = Number(withdrawal.netPayoutKes);

    if (!push.autoConfirmed) {
      return { status: 'STARTED', withdrawalId: withdrawal.id, msisdn: withdrawal.msisdn, feeKes, netPayoutKes, alreadyConfirmed: false };
    }
    await confirmWalletWithdrawal(push.conversationId, push.mpesaTransactionId ?? '');
    revalidatePath('/me/wallet');
    revalidatePath('/me');
    return { status: 'STARTED', withdrawalId: withdrawal.id, msisdn: withdrawal.msisdn, feeKes, netPayoutKes, alreadyConfirmed: true };
  } catch (e: unknown) {
    if (e instanceof WalletWithdrawalError) return { status: 'REJECTED', message: e.message };
    if (e instanceof MpesaError) {
      if (withdrawalId) {
        await failWalletWithdrawalById(withdrawalId, `M-Pesa declined the payout: ${e.message}`).catch(() => {});
      }
      return { status: 'REJECTED', message: e.message };
    }
    console.error('wallet withdrawal failed', e, { withdrawalId });
    return { status: 'ERROR', message: 'Something went wrong. Try again in a moment.' };
  }
}

// ── Esoqo-to-Esoqo transfer ──────────────────────────────────────────

export type SendMoneyResult =
  | { status: 'SENT'; transferId: string; receiverName: string; amountKes: number }
  | { status: 'REJECTED'; message: string }
  | { status: 'ERROR'; message: string };

/**
 * Settles synchronously — there is no M-Pesa leg to wait on, so unlike
 * actionTopUpWallet/actionWithdrawWallet this either succeeds completely
 * (ledger posted, both parties notified) or fails completely, in one call.
 */
export async function actionSendMoney(input: { toIdentifier: string; amountKes: number; note?: string }): Promise<SendMoneyResult> {
  const ctx = await requireSubject();
  try {
    const { transfer, notify } = await createEsoqoTransfer(ctx, input);

    // Best-effort, same reason /pay's notifySms is: the transfer is
    // already confirmed and the ledger already balanced by the time this
    // runs, so an SMS provider hiccup must not change the outcome.
    const sends: Promise<unknown>[] = [];
    if (notify.senderMsisdn) {
      sends.push(sendSms(
        notify.senderMsisdn,
        transferSentSms({ amountKes: notify.amountKes, counterpartyName: notify.receiverName }),
        'esoqo-transfer-sent',
      ));
    }
    for (const to of notify.receiverMsisdns) {
      sends.push(sendSms(
        to,
        transferReceivedSms({ amountKes: notify.amountKes, counterpartyName: notify.senderName, note: notify.note }),
        'esoqo-transfer-received',
      ));
    }
    const results = await Promise.allSettled(sends);
    for (const r of results) {
      if (r.status === 'rejected') console.error('esoqo transfer SMS failed', r.reason, { transferId: transfer.id });
    }

    revalidatePath('/me/wallet');
    revalidatePath('/me');
    return { status: 'SENT', transferId: transfer.id, receiverName: notify.receiverName, amountKes: notify.amountKes };
  } catch (e: unknown) {
    if (e instanceof EsoqoTransferError) return { status: 'REJECTED', message: e.message };
    console.error('esoqo transfer failed', e);
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
