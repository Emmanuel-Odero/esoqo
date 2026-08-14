'use server';
import { createBooking, listAvailableSeats, attachBookingCheckoutRequestId, confirmBookingPayment, getBookingStatus } from '@esoko/db';
import { createBookingSchema, toSafeErrorMessage } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

/**
 * Booking as a signed-in subject only — the page gates this behind
 * "sign in first", but the DAL (createBooking → requireCapability) is
 * the real boundary, same as everywhere else. See ADR-0003.
 *
 * Payment mirrors apps/store's checkout: place the booking first (it
 * starts PENDING_PAYMENT), then trigger the STK push. In console mode
 * the push auto-confirms and the booking is already PAID by the time
 * this returns; against the real Daraja sandbox/production it stays
 * PENDING_PAYMENT until the webhook in services/core calls
 * confirmBookingPayment — the client polls actionCheckBookingStatus
 * for that.
 */
export async function actionCreateBooking(raw: unknown) {
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you selected' };

  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) return { ok: false as const, error: 'Sign in to book.' };

  let booking;
  try {
    booking = await createBooking(ctx, parsed.data);
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, "That booking didn't go through. Please try again.") };
  }

  if (parsed.data.paymentMethod !== 'MPESA_STK') {
    return { ok: true as const, data: { bookingId: booking.id, status: booking.status } };
  }

  try {
    const push = await initiateStkPush({
      msisdn: parsed.data.buyerMsisdn,
      amountKes: Number(booking.totalKes),
      accountReference: `EKT${booking.id.slice(0, 8)}`,
      description: 'Esoko ticket',
    });
    await attachBookingCheckoutRequestId(booking.id, push.checkoutRequestId);
    if (push.autoConfirmed) {
      await confirmBookingPayment(push.checkoutRequestId);
      return { ok: true as const, data: { bookingId: booking.id, status: 'PAID' as const } };
    }
  } catch (e) {
    // The booking (and its seats/GA slots) already exist and stay
    // PENDING_PAYMENT — the buyer can retry payment rather than losing
    // the ticket outright. Told apart from a booking failure above.
    console.error(e);
    return {
      ok: true as const,
      data: { bookingId: booking.id, status: 'PENDING_PAYMENT' as const },
      warning: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment — try again from My tickets.',
    };
  }

  return { ok: true as const, data: { bookingId: booking.id, status: 'PENDING_PAYMENT' as const } };
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — console mode never visits this, since the push above
 *  already auto-confirmed before this action's caller gets a chance
 *  to poll. */
export async function actionCheckBookingStatus(bookingId: string) {
  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) return null;
  return getBookingStatus(ctx, bookingId).catch(() => null);
}

export async function actionListAvailableSeats(scheduleId: string, ticketClassId: string) {
  const seats = await listAvailableSeats(scheduleId, ticketClassId);
  return seats;
}
