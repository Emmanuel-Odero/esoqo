'use server';

import {
  anonCtx,
  findParkingLot,
  checkInParking,
  getParkingSession,
  quoteParkingCheckout,
  resolveParkingCharge,
  createBusinessPayment,
  attachBusinessPaymentCheckoutRequestId,
  confirmBusinessPayment,
  failBusinessPaymentById,
  ParkingError,
  BusinessPaymentError,
  type ParkingLotView,
  type ParkingSessionView,
} from '@esoqo/db';
import { initiateStkPush, MpesaError } from '@esoqo/payments';
import { sendSms } from '@esoqo/auth/sms';
import { normaliseMsisdn, parkingCheckInSms, parkingPaidSms } from '@esoqo/domain';

/**
 * Server actions for /pay/parking.
 *
 * The shape is a parcel tracking code rather than a checkout: scan the
 * lot's QR, get a ticket by SMS, type the ticket back at the barrier,
 * pay. No capability anywhere, for the same reason /pay has none — a
 * driver at a boom gate is by definition not signed in, and the ticket
 * code is the only credential.
 *
 * Which means every rule has to live here, because nothing on this path
 * can be authenticated:
 *
 *   · The lot is re-resolved from its code on every call. A page that
 *     says "50/hour" proves nothing about what the lot charges.
 *   · The price is never taken from the browser. Checkout asks the DAL
 *     for the quote, and the STK push uses the number the DAL returned.
 *     createBusinessPayment then re-checks the amount against the
 *     session, so even a tampered action call cannot bill a car park an
 *     arbitrary figure.
 *   · The payee is the lot's operator, resolved server-side. The client
 *     never names a party.
 */

const ctx = anonCtx();

/* ── lot ─────────────────────────────────────────────────────────────── */

export type ParkingLotLookup =
  | { status: 'FOUND'; lot: ParkingLotView }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_PAYABLE' };

/**
 * Resolves a printed lot code — or a whole scanned URL, since somebody
 * will photograph the link rather than the code.
 *
 * NOT_PAYABLE is distinct from NOT_FOUND because the two need different
 * words on screen: a car park that exists but cannot take money is a
 * reason to find another one, which "no such car park" would not tell
 * anybody.
 */
export async function actionParkingLot(identifier: string): Promise<ParkingLotLookup> {
  const lot = await findParkingLot(identifier).catch(() => null);
  if (!lot) return { status: 'NOT_FOUND' };
  if (!lot.payable) return { status: 'NOT_PAYABLE' };
  return { status: 'FOUND', lot };
}

/* ── check in ────────────────────────────────────────────────────────── */

export type ParkingCheckInResult =
  | { status: 'CHECKED_IN'; session: ParkingSessionView }
  | { status: 'REJECTED'; message: string };

/**
 * Parks a car and texts the ticket.
 *
 * The SMS is best-effort and happens after the row exists: a lost text
 * must not mean a lost car. A driver standing at a gate who never
 * receives the code is shown it on screen and can copy it, which is why
 * the ticket is returned in every success case and not only when SMS
 * works.
 */
export async function actionParkingCheckIn(input: {
  lotCode: string;
  msisdn: string;
  plateNo?: string;
}): Promise<ParkingCheckInResult> {
  let session: ParkingSessionView | null = null;
  try {
    session = await checkInParking(ctx, {
      lotCode: input.lotCode,
      msisdn: input.msisdn,
      plateNo: input.plateNo ?? null,
    });
  } catch (e: unknown) {
    if (e instanceof ParkingError) return { status: 'REJECTED', message: e.message };
    return { status: 'REJECTED', message: 'We could not park that car. Please try again.' };
  }

  const lot = await findParkingLot(input.lotCode);
  // Sent to the number the DAL actually stored, not the one that was
  // typed: "0722 000 003" and "+254722000003" are the same phone, and
  // the ticket has to arrive at the phone the driver is holding.
  const ticketMsisdn = normaliseMsisdn(input.msisdn) ?? input.msisdn;
  if (lot) {
    await sendSms(
      ticketMsisdn,
      parkingCheckInSms({
        lotName: lot.name,
        ticketCode: session.ticketCode,
        graceMinutes: session.graceMinutes,
        ratePerHourKes: session.ratePerHourKes,
      }),
      'parking-check-in',
    ).catch((reason: unknown) => {
      // The ticket is on the next line of the page and the driver is
      // looking at it, so a failed text is a nuisance rather than a
      // failure. Logged, not swallowed silently.
      console.error(`[/pay/parking ${session.ticketCode}] the ticket SMS failed:`, reason);
    });
  }

  return { status: 'CHECKED_IN', session };
}

/* ── checkout ────────────────────────────────────────────────────────── */

export type ParkingQuoteResult =
  | { status: 'QUOTED'; session: ParkingSessionView }
  | { status: 'FREE'; session: ParkingSessionView }
  | { status: 'PAID'; session: ParkingSessionView }
  | { status: 'REJECTED'; message: string };

/**
 * Closes a stay and prices it.
 *
 * FREE is a first-class outcome rather than an error: inside the grace
 * period the driver owes nothing, and the screen has to say that in
 * words instead of trying to take KES 0. VOIDED and unknown both come
 * back as a message, because "that ticket does not work" is a different
 * conversation from "here is your bill".
 */
export async function actionParkingQuote(ticketCode: string): Promise<ParkingQuoteResult> {
  const existing = await getParkingSession(ticketCode).catch(() => null);
  if (!existing) return { status: 'REJECTED', message: 'We cannot find that ticket. Check the code and try again.' };
  if (existing.status === 'VOIDED') return { status: 'REJECTED', message: 'That ticket was cancelled by the car park.' };
  if (existing.status === 'PAID') return { status: 'PAID', session: existing };

  let session: ParkingSessionView;
  try {
    session = await quoteParkingCheckout(ctx, ticketCode);
  } catch (e: unknown) {
    if (e instanceof ParkingError) return { status: 'REJECTED', message: e.message };
    return { status: 'REJECTED', message: 'We could not price that stay. Please try again.' };
  }

  return session.amountKes === 0 ? { status: 'FREE', session } : { status: 'QUOTED', session };
}

/* ── pay ─────────────────────────────────────────────────────────────── */

export type StartParkingPaymentResult =
  | { status: 'STARTED'; paymentId: string; alreadyConfirmed: boolean }
  | { status: 'ALREADY_PAID' }
  | { status: 'FREE'; session: ParkingSessionView }
  | { status: 'REJECTED'; message: string }
  | { status: 'ERROR'; message: string };

/**
 * Charges exactly what the lot quoted, to exactly the lot that quoted it.
 *
 * Note there is no amount in the input. That is the whole point: the
 * price is a function of how long the car sat there, and the only party
 * entitled to decide that is the car park. A client that could send an
 * amount would be a client that could send KES 1.
 */
export async function actionStartParkingPayment(input: {
  ticketCode: string;
  msisdn: string;
}): Promise<StartParkingPaymentResult> {
  const session = await getParkingSession(input.ticketCode).catch(() => null);
  if (!session) return { status: 'REJECTED', message: 'We cannot find that ticket.' };
  if (session.status === 'VOIDED') return { status: 'REJECTED', message: 'That ticket was cancelled by the car park.' };
  if (session.status === 'PAID') return { status: 'ALREADY_PAID' };

  const charge = await resolveParkingCharge(input.ticketCode);
  if (!charge) {
    // A stay inside its grace period: genuinely nothing to pay, so the
    // stay is settled and the driver is told so in words.
    const fresh = session.status === 'QUOTED' ? session : await actionParkingQuote(input.ticketCode);
    if (fresh.status === 'FREE') return { status: 'FREE', session: fresh.session };
    return { status: 'REJECTED', message: 'We could not price that stay. Please try again.' };
  }

  let paymentId: string | null = null;
  try {
    const payment = await createBusinessPayment(ctx, {
      payeePartyId: charge.partyId,
      amountKes: charge.amountKes,
      payerMsisdn: input.msisdn,
      parkingSessionId: charge.sessionId,
    });
    paymentId = payment.id;

    const push = await initiateStkPush({
      msisdn: payment.payerMsisdn,
      amountKes: Number(payment.amountKes),
      accountReference: `ESOQO ${payment.payeeEsoqoId}`,
      // A driver authorising this at a barrier sees this line and
      // nothing else, so it names the car park rather than saying
      // "payment" and leaving them to guess what for.
      description: `Parking at ${charge.lotName}`.slice(0, 60),
    });

    await attachBusinessPaymentCheckoutRequestId(payment.id, push.checkoutRequestId);

    if (!push.autoConfirmed) return { status: 'STARTED', paymentId: payment.id, alreadyConfirmed: false };

    const confirmed = await confirmBusinessPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    await notifyParkingSms(confirmed, payment.id);
    return { status: 'STARTED', paymentId: payment.id, alreadyConfirmed: true };
  } catch (e: unknown) {
    if (e instanceof BusinessPaymentError) return { status: 'REJECTED', message: e.message };
    if (e instanceof MpesaError) {
      if (paymentId) {
        await failBusinessPaymentById(paymentId, `M-Pesa declined to send the prompt: ${e.message}`)
          .catch(() => { /* the row is PENDING; the status screen will show it */ });
      }
      return { status: 'REJECTED', message: e.message };
    }
    // A bug, not a decline — see the same catch in ../../actions.ts.
    console.error(`[/pay/parking] start-payment failed${paymentId ? ` for ${paymentId}` : ''}:`, e);
    return { status: 'ERROR', message: 'We could not start that payment. Please try again.' };
  }
}

/**
 * Tells the driver their stay is paid.
 *
 * The car park gets no text, deliberately. For a shop that is a sale; for
 * a car park it is a barrier attendant learning a stranger's mobile
 * number, which is not a thing the driver agreed to by parking. The lot
 * learns the stay is settled from the session itself, and the
 * attendant lifts the gate on that.
 *
 * Best-effort, as everywhere: the payment is confirmed and the ledger
 * balanced before this runs.
 */
async function notifyParkingSms(
  result: Awaited<ReturnType<typeof confirmBusinessPayment>>,
  paymentId: string,
): Promise<void> {
  const n = result.notify;
  if (!result.justConfirmed || !n) return;
  try {
    await sendSms(
      n.payerMsisdn,
      parkingPaidSms({
        amountKes: n.amountKes,
        lotName: n.businessName,
        receiptCode: n.receiptCode,
      }),
      'parking-paid',
    );
  } catch (reason) {
    console.error(`[/pay/parking ${paymentId}] the paid SMS failed:`, reason);
  }
}
