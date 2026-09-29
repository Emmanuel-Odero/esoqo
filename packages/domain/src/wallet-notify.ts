/**
 * SMS copy for wallet withdrawal and Esoqo-to-Esoqo transfer — same pure
 * composition pattern as business-payment-notify.ts, for the same reason:
 * the console-mode auto-confirm path and the real Daraja/B2C confirmation
 * path must produce identical wording rather than drift apart.
 */
import { sms, fit, smsKes } from './sms';

export interface WalletWithdrawalNotifyContext {
  amountKes: number;
  feeKes: number;
  netPayoutKes: number;
  msisdn: string;
}

/** To the person who just cashed out — the fee is stated, not hidden,
 *  because "why did I get less than I asked for" is the single most
 *  predictable support ticket a withdrawal can generate. */
export function walletWithdrawalConfirmedSms(ctx: WalletWithdrawalNotifyContext): string {
  return ctx.feeKes > 0
    ? sms`Esoqo: ${smsKes(ctx.netPayoutKes)} sent to ${fit(ctx.msisdn, 16)} (${smsKes(ctx.amountKes)} less ${smsKes(ctx.feeKes)} fee).`
    : sms`Esoqo: ${smsKes(ctx.netPayoutKes)} sent to ${fit(ctx.msisdn, 16)}.`;
}

export function walletWithdrawalFailedSms(reason: string): string {
  return sms`Esoqo: your withdrawal did not go through. ${fit(reason, 80)}`;
}

export interface EsoqoTransferNotifyContext {
  amountKes: number;
  /** The other party's display name — who paid, or who got paid,
   *  depending which side this message is for. */
  counterpartyName: string;
  note?: string | null;
}

/** To the sender, once a transfer settles. Instant by construction (no
 *  M-Pesa leg), so there is no separate "started" message the way a
 *  withdrawal or top-up needs one. */
export function transferSentSms(ctx: EsoqoTransferNotifyContext): string {
  return sms`Esoqo: ${smsKes(ctx.amountKes)} sent to ${fit(ctx.counterpartyName, 40)}.`;
}

/** To the receiver. */
export function transferReceivedSms(ctx: EsoqoTransferNotifyContext): string {
  const noted = ctx.note?.trim() ? ` "${fit(ctx.note.trim(), 40)}"` : '';
  return sms`Esoqo: ${smsKes(ctx.amountKes)} received from ${fit(ctx.counterpartyName, 34)}.${noted}`;
}
