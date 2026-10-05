/**
 * SMS copy for the automatic purchase receipt — sent the moment a
 * PosSale rings up, a StoreOrder is paid, or a BusinessPayment settles.
 * Same pure-composition pattern as store-notify.ts/business-payment-notify.ts,
 * for the same reason: whichever settlement handler actually calls
 * `sendSms` (recordPosSale's caller, the two StoreOrder confirmers, or
 * the two BusinessPayment webhook handlers) must all compose identical
 * wording rather than drifting apart.
 *
 * This *replaces* saleReceiptSms (store-notify.ts) at every automatic
 * send site because it's the one that actually names the shop and gives
 * a verifiable link — saleReceiptSms itself stays only for the manual
 * print/SMS re-send button, which has no reason to change.
 */
import { sms, fit, smsKes } from './sms';

export interface PurchaseReceiptContext {
  storeName: string;
  amountKes: number;
  /** The Receipt's own "RC…" code (generateTransactionCode,
   *  TRANSACTION_CODE_KINDS.RECEIPT) — what the verify link resolves. */
  receiptCode: string;
}

/**
 * "{store}: KES {amount} paid. Receipt {code}. View it at
 * esoqo.co.ke/verify/{code}." — the store name up front (same reasoning
 * saleReceiptSms's own doc comment gives: a shop's SMS sender ID is
 * ESOQO for everyone, so the shop's own name is the only way a shopper
 * tells today's several purchases apart), the amount because a receipt
 * that never says what was paid is the one thing every other receipt
 * template in this file (saleReceiptSms, payerPaymentReceiptSms,
 * businessPaymentAlertSms) treats as non-negotiable, and the code
 * quoted once rather than twice — the link already carries it, and
 * every repeated character is one this budget can't get back.
 */
export function purchaseReceiptSms(ctx: PurchaseReceiptContext): string {
  return sms`${fit(ctx.storeName, 34)}: ${smsKes(ctx.amountKes)} paid. Receipt ${fit(ctx.receiptCode, 20)}. View: esoqo.co.ke/verify/${fit(ctx.receiptCode, 20)}`;
}
