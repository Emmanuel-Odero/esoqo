/**
 * SMS copy for a payment made to a business on the /pay page.
 *
 * Same pure-composition pattern as donation-notify.ts, for the same
 * reason: the two callers that actually send these — the /pay Server
 * Action (console-mode auto-confirm) and services/core's Daraja webhook
 * handler (the real confirmation path) — must compose identical wording
 * rather than drifting apart.
 *
 * ## Who each message is for
 *
 * `payerPaymentReceiptSms` goes to the person who just handed over
 * money. They need three things and nothing else: the amount, who got
 * it, and references they can quote to the business. What Esoqo adds
 * on top of Safaricom's own confirmation is the Esoqo receipt code.
 *
 * There is deliberately no *pay* link in it. The only pay link that
 * exists leads back to the form that asks for money again, so a shopper
 * holding a receipt for a payment they already made would be one tap
 * from starting a second one. (The parking receipt dropped its link for
 * exactly this reason before this one did.) A *verify* link is a
 * different thing — read-only, no amount field, cannot start a second
 * payment — so once a payment mints a Receipt (see issueReceiptFor in
 * dal/receipt.ts) its verify code rides along as `receiptVerifyCode`
 * below and the clause is appended. Parking never sets it: it settles
 * through parkingPaidSms instead, which never had a Receipt to link to.
 *
 * `businessPaymentAlertSms` goes to the business owner. The amount is
 * the news; a payer's phone number is the reply address if something
 * looks wrong. Neither is optional and neither is embellished.
 *
 * ## The two receipt codes
 *
 * Both messages carry two references, and the difference is not
 * cosmetic. Esoqo's `BP-…` is ours: it resolves in our system, and it is
 * the only one a support agent can look up. Safaricom's M-Pesa code is
 * the one on the payer's M-Pesa statement and the only one that lines up
 * against a real bank or M-Pesa statement — which is exactly what the
 * business owner is doing when the money lands and has to be
 * reconciled. An owner told "30 received" with no M-Pesa code has to
 * match it to a statement line by amount and timestamp, which is a
 * guess; with the code it is a lookup.
 *
 * They are not interchangeable and neither replaces the other, so both
 * are quoted. The M-Pesa code is genuinely optional — console mode has
 * none, and Safaricom omits it on some callbacks — so it is dropped
 * whole rather than sent as an empty "M-Pesa ." when absent.
 *
 * Every variable field is clamped with `fit` and business-payment.test.ts
 * holds the worst case to one GSM-7 segment, as sms.test.ts's own budget
 * block describes.
 */
import { sms, fit, smsKes } from './sms';

export interface BusinessPaymentNotifyContext {
  amountKes: number;
  businessName: string;
  /** Esoqo's own reference for this payment, e.g. "BP-7K3H92XQ" — not
   *  Safaricom's M-Pesa receipt code, and not interchangeable with it. */
  receiptCode: string;
  /** Safaricom's M-Pesa receipt code, e.g. "UIQRI7ZKTH" — the code on
   *  the payer's M-Pesa statement, and what a business reconciles
   *  against. Null or absent on the console provider and on a callback
   *  that arrived without one, in which case the message omits it. */
  mpesaReceiptCode?: string | null;
  /** The payer's own number, for the business's alert only. */
  payerMsisdn?: string | null;
  /** The verify-page code of the Receipt this payment minted (see
   *  issueReceiptFor in dal/receipt.ts) — a THIRD reference, distinct
   *  from both codes above, only ever present on the payer's copy.
   *  Absent for a parking payment (parkingPaidSms is its own template)
   *  and for a payment whose Receipt failed to mint for some reason;
   *  the clause is dropped whole rather than sent broken. */
  receiptVerifyCode?: string | null;
}

/**
 * The M-Pesa receipt clause, or nothing.
 *
 * Dropped whole when absent rather than rendered as a bare "M-Pesa .": an
 * empty field is worse than a missing one, because it reads as a value
 * that failed to arrive instead of one that was never issued. Clamped
 * like every other variable field — Safaricom's codes are 10 characters,
 * but a callback is untrusted input and the budget is enforced here
 * regardless of what arrives.
 */
function withMpesaCode(message: string, code: string | null | undefined): string {
  const clean = code?.trim();
  if (!clean) return message;
  return `${message} M-Pesa ${fit(clean, 12)}.`;
}

/** The verify-page clause, or nothing — see receiptVerifyCode's own doc
 *  comment on BusinessPaymentNotifyContext for why this one but not the
 *  pay link. Dropped whole when absent, same "no bare field" rule
 *  withMpesaCode follows just above. */
function withVerifyLink(message: string, code: string | null | undefined): string {
  const clean = code?.trim();
  if (!clean) return message;
  return `${message} View: esoqo.co.ke/verify/${fit(clean, 20)}`;
}

/** To the payer, once their payment is confirmed. */
export function payerPaymentReceiptSms(ctx: BusinessPaymentNotifyContext): string {
  const message = sms`Esoqo: ${smsKes(ctx.amountKes)} paid to ${fit(ctx.businessName, 34)}. Receipt ${fit(ctx.receiptCode, 20)}.`;
  return withVerifyLink(withMpesaCode(message, ctx.mpesaReceiptCode), ctx.receiptVerifyCode);
}

/**
 * To the business owner, so money landing is news without them having
 * to open a dashboard.
 *
 * The payer's number is the whole reason this message goes to them
 * rather than only landing in a ledger: if a payment looks wrong, the
 * owner's first question is "who paid?", and answering it must not
 * require a staff login.
 */
export function businessPaymentAlertSms(ctx: BusinessPaymentNotifyContext): string {
  const who = ctx.payerMsisdn ? ` from ${fit(ctx.payerMsisdn, 16)}` : '';
  const message = sms`Esoqo: ${smsKes(ctx.amountKes)} received${who} for ${fit(ctx.businessName, 38)}. Receipt ${fit(ctx.receiptCode, 20)}.`;
  return withMpesaCode(message, ctx.mpesaReceiptCode);
}
