'use server';

import {
  anonCtx,
  lookupPayee,
  createBusinessPayment,
  attachBusinessPaymentCheckoutRequestId,
  confirmBusinessPayment,
  failBusinessPaymentById,
  getBusinessPayment,
  reconcileBusinessPayment,
  BusinessPaymentError,
  type ConfirmBusinessPaymentResult,
} from '@esoqo/db';
import { initiateStkPush, MpesaError } from '@esoqo/payments';
import { sendSms } from '@esoqo/auth/sms';
import { payerPaymentReceiptSms, businessPaymentAlertSms, parkingPaidSms } from '@esoqo/domain';

/**
 * Server actions behind /pay.
 *
 * Everything financial happens here rather than in the client: the
 * payee is re-resolved server-side, the amount is re-validated, and the
 * payment is persisted before the STK push is even attempted. A browser
 * that has been tampered with can only ever ask for a payment it has
 * named in full — it cannot name a different payee than the one it
 * displayed, because the id it sends is looked up again.
 *
 * No capability anywhere: /pay is a public page, the same contract as
 * getOrder and getDonation. The payment id is the only secret, and
 * nothing returned from here carries the payee's contact details.
 */

const ctx = anonCtx();

export interface PayeeView {
  partyId: string;
  esoqoId: string;
  name: string;
  county: string | null;
  registrationNo: string | null;
  kind: string;
}

export type BusinessLookup =
  | { status: 'FOUND'; businesses: PayeeView[] }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_PAYABLE' }
  | { status: 'EMPTY' };

/** Resolves whatever the payer typed or scanned into businesses they
 *  can pay. Phrased as a discriminated shape rather than a list so the
 *  page can tell "no such business" apart from "that business exists
 *  but can't take payments" — two very different things to say to
 *  someone holding a QR that doesn't work. */
export async function actionLookupBusiness(identifier: string): Promise<BusinessLookup> {
  const result = await lookupPayee(ctx, identifier);
  if (result.status !== 'FOUND') return result;
  return {
    status: 'FOUND',
    businesses: result.businesses.map((b) => ({
      partyId: b.partyId,
      esoqoId: b.esoqoId,
      name: b.name,
      county: b.county,
      registrationNo: b.registrationNo,
      kind: b.kind,
    })),
  };
}

export interface StartPaymentInput {
  payeePartyId: string;
  amountKes: number;
  payerMsisdn: string;
  payerName?: string;
  payerEsoqoId?: string;
  note?: string;
}

export type StartPaymentResult =
  | { status: 'STARTED'; paymentId: string; alreadyConfirmed: boolean }
  | { status: 'REJECTED'; message: string }
  | { status: 'ERROR'; message: string };

/**
 * Records the payment, pushes the STK prompt, and in console mode
 * confirms it immediately so the waiting screen is still exercised.
 *
 * The order matters and is not negotiable. The row is written FIRST so
 * a crash between here and Safaricom cannot lose a payment the customer
 * believes they made; if the push then fails, the row is failed too
 * rather than left PENDING, which would count as unsettled revenue for
 * a transaction that never left the building.
 */
export async function actionStartPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
  let paymentId: string | null = null;
  try {
    const payment = await createBusinessPayment(ctx, {
      payeePartyId: input.payeePartyId,
      amountKes: input.amountKes,
      payerMsisdn: input.payerMsisdn,
      payerName: input.payerName,
      payerEsoqoId: input.payerEsoqoId,
      note: input.note,
    });
    paymentId = payment.id;

    const push = await initiateStkPush({
      msisdn: payment.payerMsisdn,
      amountKes: Number(payment.amountKes),
      // Shown on the payer's own phone prompt, so it has to be short
      // and recognisable — this is the only line the customer sees while
      // deciding whether to authorise the payment.
      accountReference: `ESOQO ${payment.payeeEsoqoId}`,
      description: `Payment to ${payment.payeeName}`.slice(0, 60),
    });

    await attachBusinessPaymentCheckoutRequestId(payment.id, push.checkoutRequestId);

    if (!push.autoConfirmed) {
      // Real Safaricom will call services/core's webhook; the payer sees
      // this screen until then.
      return { status: 'STARTED', paymentId: payment.id, alreadyConfirmed: false };
    }

    const confirmed = await confirmBusinessPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    await notifySms(confirmed, payment.id);
    return { status: 'STARTED', paymentId: payment.id, alreadyConfirmed: true };
  } catch (e: unknown) {
    if (e instanceof BusinessPaymentError) {
      return { status: 'REJECTED', message: e.message };
    }
    if (e instanceof MpesaError) {
      if (paymentId) {
        await failBusinessPaymentById(paymentId, `M-Pesa declined to send the prompt: ${e.message}`)
          .catch(() => { /* the row is PENDING; the status screen will show it */ });
      }
      return { status: 'REJECTED', message: e.message };
    }
    // Everything left is a bug rather than a declined payment — a Prisma
    // error, a TypeError, a fetch that threw. The customer gets a generic
    // line on purpose, but swallowing the cause with no trace at all is
    // how "it says try again" becomes an afternoon with no clue: log the
    // real error and the payment id, so the server log is the answer.
    console.error(`[/pay] start-payment failed${paymentId ? ` for ${paymentId}` : ''}:`, e);
    return { status: 'ERROR', message: 'We could not start that payment. Please try again.' };
  }
}

/** Mirrors what the M-Pesa webhook sends on a real payment, for the
 *  console provider, which confirms locally and never calls us back.
 *
 *  Best-effort throughout: the payment is already confirmed and the
 *  ledger already balanced before this runs, so an SMS provider being
 *  down must not change the outcome or fail the request. */
async function notifySms(
  result: ConfirmBusinessPaymentResult,
  paymentId: string,
): Promise<void> {
  const n = result.notify;
  if (!result.justConfirmed || !n) return;

  // A parking charge is not a business payment with a car attached: the
  // payer's receipt must name the ticket, and the pay link — which points
  // at a page asking for money again — is worse than useless once the
  // stay is already settled. Same code path, different message.
  if (n.parking) {
    await sendSms(
      n.payerMsisdn,
      parkingPaidSms({ amountKes: n.amountKes, lotName: n.parking.lotName, receiptCode: n.receiptCode }),
      'parking-paid',
    ).catch((reason) => {
      console.error(`[/pay ${paymentId}] the parking receipt SMS failed:`, reason);
    });
    // No operator alert, deliberately. The usual business alert carries
    // the payer's number so the payee can chase a bad cheque; here the
    // payee is a car park that already knows a car paid, and texting a
    // driver's number to whoever is on the barrier hands a private
    // number to a stranger. The lot learns about it from the session.
    return;
  }

  const messages = [
    sendSms(
      n.payerMsisdn,
      payerPaymentReceiptSms({
        amountKes: n.amountKes,
        businessName: n.businessName,
        receiptCode: n.receiptCode,
        mpesaReceiptCode: n.mpesaReceiptCode,
      }),
      'business-payment-receipt',
    ),
    ...n.businessMsisdns.map((to) =>
      sendSms(
        to,
        businessPaymentAlertSms({
          amountKes: n.amountKes,
          businessName: n.businessName,
          receiptCode: n.receiptCode,
          mpesaReceiptCode: n.mpesaReceiptCode,
          payerMsisdn: n.payerMsisdn,
        }),
        'business-payment-alert',
      ),
    ),
  ];
  const settled = await Promise.allSettled(messages);
  for (const r of settled) {
    if (r.status === 'rejected') {
      console.error(`[/pay ${paymentId}] a notification SMS failed:`, r.reason);
    }
  }
}

export type PaymentStatusView =
  | { status: 'PENDING'; reference: string | null }
  | { status: 'CONFIRMED'; amountKes: number; payeeName: string; receiptCode: string | null; mpesaReceiptCode: string | null }
  | { status: 'FAILED'; reason: string | null }
  | { status: 'UNKNOWN' };

/** What the waiting screen polls. Deliberately narrow: the payer is
 *  told whether it worked, not handed the row. The payee's contact
 *  details are not on a BusinessPayment at all, and the payer's own name
 *  and note are theirs, but there is no reason to ship them back either.
 *
 *  A payment id that doesn't resolve is UNKNOWN rather than an error —
 *  the page must not leak whether a guessed uuid exists.
 *
 *  PENDING is not simply re-read: reconcileBusinessPayment asks Safaricom
 *  directly first, because the callback that normally settles a payment
 *  is a request into a URL that is, in local development, a tunnel.
 *  Without it this screen can only report what the callback wrote, and a
 *  lost callback means the payer is never told anything at all.
 *
 *  Note there is no UNRESOLVED here. "Safaricom says still pending" and
 *  "we have stopped looking" are different things, and only the payer's
 *  browser decides when to stop looking — the row is honestly PENDING
 *  either way. The reference rides along so a customer told to chase the
 *  business has something to quote. */
export async function actionPaymentStatus(paymentId: string): Promise<PaymentStatusView> {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return { status: 'UNKNOWN' };

  // Best effort. If Daraja is unreachable the row is still worth reading,
  // so a failed query must not take the whole status read down with it.
  const settled = await reconcileBusinessPayment(paymentId).catch(() => null);

  // A payment can be settled by the query rather than by the callback —
  // that is the entire point of asking. But the shopper's receipt is
  // still owed to them, and the callback that would normally have sent
  // it is the very thing that did not arrive. Without this the fallback
  // would confirm the payment, balance the ledger, and tell nobody:
  // the money is right and the customer is left staring at a spinner.
  // Safe to call on every poll because it only fires on the one poll
  // that actually confirmed.
  if (settled?.confirmed) {
    await notifySms(settled.confirmed, paymentId);
  }

  const payment = await getBusinessPayment(paymentId);
  if (!payment) return { status: 'UNKNOWN' };

  if (payment.status === 'CONFIRMED') {
    return {
      status: 'CONFIRMED',
      amountKes: Number(payment.amountKes),
      payeeName: payment.payeeName,
      receiptCode: payment.receiptCode,
      mpesaReceiptCode: payment.mpesaReceiptCode,
    };
  }
  if (payment.status === 'FAILED') {
    return { status: 'FAILED', reason: payment.failureReason };
  }
  return { status: 'PENDING', reference: payment.receiptCode };
}
