'use server';
import {
  createBooking, listAvailableSeats, listScheduleSeats, attachBookingCheckoutRequestId,
  attachBookingPaymentCheckoutRequestId, createBookingBalancePayment, confirmBookingPayment, getBookingStatus,
} from '@esoko/db';
import { createBookingSchema, payBookingBalanceSchema, toSafeErrorMessage } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

/**
 * Public checkout — signed in or not, same boundary as apps/store's
 * createStoreOrder. See ADR-0003.
 *
 * Payment mirrors apps/store's checkout: place the booking first, then
 * trigger the STK push. In console mode the push auto-confirms and the
 * booking is already PAID by the time this returns; against real Daraja
 * it stays PENDING_PAYMENT until the services/core webhook calls
 * confirmBookingPayment — the client polls actionCheckBookingStatus.
 *
 * When `payment.plan` is INSTALLMENT ("lipia pole pole"), createBooking
 * opens a plan and returns the opening deposit payment instead of a
 * booking with tickets; the STK push is for the deposit, and the
 * booking sits PENDING_PAYMENT / PARTIALLY_PAID until the balance is
 * cleared from the booking's balance-payment page.
 */
export async function actionCreateBooking(raw: unknown) {
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you selected' };

  const ctx = await getCtx();

  let result;
  try {
    result = await createBooking(ctx, parsed.data);
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, "That booking didn't go through. Please try again.") };
  }

  // ── Installment plan: STK push for the opening deposit ────────────
  if ('depositPayment' in result) {
    const balancePayUrl = `${WEB_URL}/tickets/booking/${result.bookingId}`;
    try {
      const push = await initiateStkPush({
        msisdn: parsed.data.buyerMsisdn,
        amountKes: result.depositPayment.amountKes,
        accountReference: `EKT${result.bookingId.slice(0, 8)}`,
        description: 'Trip deposit',
      });
      await attachBookingPaymentCheckoutRequestId(result.depositPayment.id, push.checkoutRequestId);
      if (push.autoConfirmed) await confirmBookingPayment(push.checkoutRequestId);
    } catch (e) {
      console.error(e);
      return {
        ok: true as const,
        data: {
          bookingId: result.bookingId, status: 'PENDING_PAYMENT' as const, points: null,
          isInstallment: true as const, totalKes: result.totalKes,
          balanceKes: result.totalKes - result.depositPayment.amountKes,
          balanceDueBy: result.balanceDueBy.toISOString(), balancePayUrl,
        },
        warning: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment — try again from the trip payment page.',
      };
    }

    const status = await getBookingStatus(ctx, result.bookingId).catch(() => null);
    return {
      ok: true as const,
      data: {
        bookingId: result.bookingId,
        status: (status?.status ?? 'PENDING_PAYMENT') as 'PENDING_PAYMENT' | 'PARTIALLY_PAID',
        points: null,
        isInstallment: true as const,
        totalKes: result.totalKes,
        balanceKes: status?.balanceKes ?? (result.totalKes - result.depositPayment.amountKes),
        balanceDueBy: result.balanceDueBy.toISOString(),
        balancePayUrl,
      },
    };
  }

  // ── Plain booking (pay in full) ──────────────────────────────────
  const booking = result;
  if (parsed.data.paymentMethod !== 'MPESA_STK') {
    const points = booking.status === 'PAID' ? (await getBookingStatus(ctx, booking.id).catch(() => null))?.points ?? null : null;
    return { ok: true as const, data: { bookingId: booking.id, status: booking.status, points } };
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
      const points = (await getBookingStatus(ctx, booking.id).catch(() => null))?.points ?? null;
      return { ok: true as const, data: { bookingId: booking.id, status: 'PAID' as const, points } };
    }
  } catch (e) {
    console.error(e);
    return {
      ok: true as const,
      data: { bookingId: booking.id, status: 'PENDING_PAYMENT' as const, points: null },
      warning: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment — try again from My tickets.',
    };
  }

  return { ok: true as const, data: { bookingId: booking.id, status: 'PENDING_PAYMENT' as const, points: null } };
}

/**
 * Pays a portion (or the remaining balance) of an open "lipia pole
 * pole" plan and fires the M-Pesa prompt for it. Works for a guest
 * booking — createBookingBalancePayment treats the bookingId itself as
 * the secret when there's no buyerPartyId, same as actionCheckBookingStatus.
 */
export async function actionPayBookingBalance(raw: unknown) {
  const parsed = payBookingBalanceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Enter an amount' };

  const ctx = await getCtx();
  try {
    const payment = await createBookingBalancePayment(ctx, parsed.data.bookingId, parsed.data.amountKes);
    const push = await initiateStkPush({
      msisdn: payment.msisdn,
      amountKes: payment.amountKes,
      accountReference: `EKT${parsed.data.bookingId.slice(0, 8)}`,
      description: 'Trip balance',
    });
    await attachBookingPaymentCheckoutRequestId(payment.id, push.checkoutRequestId);
    if (push.autoConfirmed) await confirmBookingPayment(push.checkoutRequestId);

    const status = await getBookingStatus(ctx, parsed.data.bookingId).catch(() => null);
    return { ok: true as const, data: { status: status?.status ?? 'PARTIALLY_PAID', balanceKes: status?.balanceKes ?? null } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof MpesaError ? e.message : toSafeErrorMessage(e, 'Could not start the M-Pesa payment') };
  }
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — console mode never visits this. */
export async function actionCheckBookingStatus(bookingId: string) {
  const ctx = await getCtx();
  return getBookingStatus(ctx, bookingId).catch(() => null);
}

export async function actionListAvailableSeats(scheduleId: string, ticketClassId: string) {
  const seats = await listAvailableSeats(scheduleId, ticketClassId);
  return seats;
}

/** All seats (AVAILABLE and BOOKED) for a schedule, across every
 *  class — what the visual seat picker uses to grey out taken seats
 *  in the actual bus layout instead of just listing what's free. */
export async function actionListScheduleSeats(scheduleId: string) {
  return listScheduleSeats(scheduleId);
}
