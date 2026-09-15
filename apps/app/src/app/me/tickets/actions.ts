'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { payBookingBalanceSchema } from '@esoqo/domain';
import { requireSubject } from '@/lib/session';
import { goUrl } from '@/lib/ticketing';

const FALLBACK = 'Could not start the M-Pesa payment';

async function authedGo<T>(path: string, body?: unknown): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await fetch(goUrl(path), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !json) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

/** Re-sends the M-Pesa prompt for a booking still PENDING_PAYMENT —
 *  covers the ordinary failure modes (prompt timed out, wrong PIN,
 *  the buyer closed the app before approving) without losing the
 *  booking's already-claimed seats/GA slots. Retried in core-go
 *  (POST /v1/bookings/:id/retry). */
export async function actionRetryBookingPayment(bookingId: string) {
  try {
    await requireSubject();
    const res = await authedGo<{ status: 'PENDING_PAYMENT' | 'PAID'; paymentError?: string }>(
      `/v1/bookings/${bookingId}/retry`,
    );
    if (res.paymentError) return { ok: false as const, error: FALLBACK };
    revalidatePath('/me/tickets');
    return { ok: true as const, data: { status: res.status === 'PAID' ? ('PAID' as const) : ('PENDING_PAYMENT' as const) } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : FALLBACK };
  }
}

/** Pays a portion (or the balance) of an open "lipia pole pole" plan
 *  from My tickets via core-go (POST /v1/bookings/:id/balance). */
export async function actionPayBookingBalance(bookingId: unknown, amountKes: unknown) {
  // unknown, not string/number: the annotations are compile-time only
  // and this is a public endpoint. payBookingBalanceSchema already
  // existed for exactly this shape — it was simply never applied here,
  // so both the amount and the booking id arrived unchecked.
  const parsed = payBookingBalanceSchema.safeParse({ bookingId, amountKes });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  try {
    await requireSubject();
    const res = await authedGo<{ status: string; paymentError?: string }>(
      `/v1/bookings/${parsed.data.bookingId}/balance`,
      { amountKes: parsed.data.amountKes },
    );
    if (res.paymentError) return { ok: false as const, error: FALLBACK };
    revalidatePath('/me/tickets');
    return { ok: true as const, data: { status: res.status === 'PAID' ? ('CONFIRMED' as const) : ('PENDING' as const) } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : FALLBACK };
  }
}
