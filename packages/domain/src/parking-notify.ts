/**
 * SMS copy for parking.
 *
 * Two messages, and only two, because a parking flow should not become a
 * texting service:
 *
 *   · Check-in — the driver is standing at a barrier and needs the
 *     ticket code and nothing else. The lot name is in it so a code
 *     arriving while they are driving reads as an error rather than as
 *     spam, and the code is the single most important thing in the
 *     message: it is the only credential at checkout.
 *   · Checkout — the driver has been quoted a figure and paid it. The
 *     amount and the plate-free reference are the news. A parking
 *     receipt deliberately does not repeat the ticket code, because by
 *     the time it is sent the ticket has already been spent.
 *
 * The payer's own M-Pesa confirmation already carries Safaricom's
 * receipt code, so repeating it here would be a second, worse
 * reference. What Esoqo adds is the paid amount and the lot.
 *
 * The checkout wording is composed from the SAME parts as
 * payerPaymentReceiptSms rather than rephrased, because a driver who
 * paid for parking and a driver who paid a bill should not be able to
 * tell which one they did from the confirmation they were sent.
 */
import { sms, fit, smsKes } from './sms';

export interface ParkingCheckInNotifyContext {
  lotName: string;
  /** The ticket code, e.g. "PRT-7QW2-4X". Expensive in the budget: it is
   *  nine characters of the only credential the driver will ever need,
   *  so it is never the thing that gets clamped. */
  ticketCode: string;
  /** Free minutes before charging starts, so "nothing to pay yet" is
   *  answered before the driver has to guess it. */
  graceMinutes: number;
  /** What an hour costs, so the figure at checkout is not a surprise. */
  ratePerHourKes: number;
}

/**
 * To the driver, at the barrier.
 *
 * The lead is "parked", not "welcome to", because the driver needs to
 * be able to tell at a glance that this is a receipt for their own car
 * and not a marketing message. Grace and rate earn their place by
 * answering the two questions every driver asks at a boom gate — is it
 * free *yet*, and what will this cost me — without anybody having to
 * phone the attendant.
 */
export function parkingCheckInSms(ctx: ParkingCheckInNotifyContext): string {
  const grace = ctx.graceMinutes > 0
    ? `${ctx.graceMinutes} min free, `
    : '';
  return sms`Esoqo: parked at ${fit(ctx.lotName, 24)}. Ticket ${fit(ctx.ticketCode, 12)}. ${grace}KES ${smsKes(ctx.ratePerHourKes)}/hr.`;
}

export interface ParkingPaidNotifyContext {
  amountKes: number;
  lotName: string;
  receiptCode: string;
}

/**
 * To the driver, once checkout has been paid.
 *
 * No pay link: a parking payment is settled against a ticket the driver
 * has already spent, and there is no page left for them to go back to —
 * offering a link here would be a dead end dressed as a convenience.
 */
export function parkingPaidSms(ctx: ParkingPaidNotifyContext): string {
  return sms`Esoqo: ${smsKes(ctx.amountKes)} parking paid at ${fit(ctx.lotName, 30)}. Receipt ${fit(ctx.receiptCode, 20)}.`;
}
