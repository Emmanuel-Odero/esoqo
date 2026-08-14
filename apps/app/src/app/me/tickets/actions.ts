'use server';
import { revalidatePath } from 'next/cache';
import { getMyBookings, attachBookingCheckoutRequestId, confirmBookingPayment } from '@esoko/db';
import { toSafeErrorMessage } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { requireSubject } from '@/lib/session';

/** Re-sends the M-Pesa prompt for a booking still PENDING_PAYMENT —
 *  covers the ordinary failure modes (prompt timed out, wrong PIN,
 *  the buyer closed the app before approving) without losing the
 *  booking's already-claimed seats/GA slots. Same push path as
 *  checkout's actionCreateBooking in /tickets/[slug]. */
export async function actionRetryBookingPayment(bookingId: string) {
  try {
    const ctx = await requireSubject();
    const mine = await getMyBookings(ctx);
    const booking = mine.find((b) => b.id === bookingId);
    if (!booking) return { ok: false as const, error: 'Booking not found' };
    if (booking.status !== 'PENDING_PAYMENT') return { ok: false as const, error: 'This booking is not awaiting payment' };

    const push = await initiateStkPush({
      msisdn: booking.buyerMsisdn,
      amountKes: Number(booking.totalKes),
      accountReference: `EKT${booking.id.slice(0, 8)}`,
      description: 'Esoko ticket',
    });
    await attachBookingCheckoutRequestId(booking.id, push.checkoutRequestId);
    if (push.autoConfirmed) await confirmBookingPayment(push.checkoutRequestId);

    revalidatePath('/me/tickets');
    return { ok: true as const, data: { status: push.autoConfirmed ? ('PAID' as const) : ('PENDING_PAYMENT' as const) } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof MpesaError ? e.message : toSafeErrorMessage(e, 'Could not start the M-Pesa payment') };
  }
}
