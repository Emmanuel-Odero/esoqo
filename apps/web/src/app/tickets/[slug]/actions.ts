'use server';
import { cookies } from 'next/headers';
import { createBookingSchema, payBookingBalanceSchema, type CreateBookingInput } from '@esoko/domain';
import { SESSION_COOKIE } from '@esoko/auth';

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
// Same convention as apps/app sign-in: server-side Go calls use the
// docker/compose service URL, falling back to localhost for bare-metal dev.
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

const UNAVAILABLE = 'The booking service is unreachable. Check your connection and try again.';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

function goMessage(json: GoErrorBody | null, fallback: string): string {
  return typeof json?.error?.message === 'string' && json.error.message ? json.error.message : fallback;
}

/** Reads the session cookie for Go bearer forwarding. Absent → guest
 *  checkout (Go links buyerPartyId only when the bearer resolves). */
async function goAuthHeader(): Promise<Record<string, string>> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function goPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await goAuthHeader()) },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

/**
 * Public checkout — signed in or not, same boundary as apps/store's
 * createStoreOrder. See ADR-0003. Bookings are created by core-go
 * (plan row + STK push there); this action only validates at the
 * boundary and maps the response onto BookingForm's shape.
 *
 * In console mode the push auto-confirms and the booking is already
 * PAID by the time this returns; against real Daraja it stays
 * PENDING_PAYMENT until the core-go webhook confirms — the client
 * polls actionCheckBookingStatus.
 */
export async function actionCreateBooking(raw: unknown) {
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you selected' };

  if (parsed.data.payment?.plan === 'INSTALLMENT') {
    return openPlanViaGo(parsed.data);
  }
  return createBookingViaGo(parsed.data);
}

interface GoPlainBooking {
  bookingId: string;
  totalKes: string;
  status: 'PENDING_PAYMENT' | 'PAID';
  checkoutRequestId?: string;
  paymentError?: string;
}

async function createBookingViaGo(input: CreateBookingInput) {
  if (input.paymentMethod !== 'MPESA_STK' && input.paymentMethod !== 'VOUCHER') {
    // CASH walk-in sales happen at the till/console, never this form —
    // kept explicit rather than silently STK-pushing a cash sale.
    return { ok: false as const, error: 'Cash bookings are made at the counter.' };
  }
  let json: GoPlainBooking;
  try {
    json = await goPost<GoPlainBooking>('/v1/bookings', {
      scheduleId: input.scheduleId,
      buyerName: input.buyerName,
      buyerMsisdn: input.buyerMsisdn,
      buyerEmail: input.buyerEmail || null,
      paymentMethod: input.paymentMethod,
      voucherId: input.voucherId ?? null,
      lines: input.lines.map((l) => ({
        ticketClassId: l.ticketClassId,
        seatId: l.seatId ?? null,
        quantity: 1,
        holderName: l.holderName ?? null,
        holderMsisdn: l.holderMsisdn ?? null,
      })),
    });
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
  if (typeof json.bookingId !== 'string') {
    return { ok: false as const, error: UNAVAILABLE };
  }
  const data = { bookingId: json.bookingId, status: json.status, points: null };
  if (json.paymentError) {
    return {
      ok: true as const, data,
      warning: 'Could not start the M-Pesa payment — try again from My tickets.',
    };
  }
  return { ok: true as const, data };
}

interface GoOpenPlan {
  bookingId: string;
  status: 'PENDING_PAYMENT' | 'PARTIALLY_PAID';
  totalKes: string;
  balanceKes: string;
  balanceDueBy: string;
  paymentError?: string;
}

async function openPlanViaGo(input: CreateBookingInput) {
  let json: GoOpenPlan;
  try {
    json = await goPost<GoOpenPlan>('/v1/bookings/installment', {
      scheduleId: input.scheduleId,
      buyerName: input.buyerName,
      buyerMsisdn: input.buyerMsisdn,
      buyerEmail: input.buyerEmail || null,
      depositKes: input.payment?.depositKes ?? 0,
      lines: input.lines.map((l) => ({
        ticketClassId: l.ticketClassId,
        holderName: l.holderName ?? null,
        holderMsisdn: l.holderMsisdn ?? null,
      })),
    });
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
  if (typeof json.bookingId !== 'string') {
    return { ok: false as const, error: UNAVAILABLE };
  }
  const data = {
    bookingId: json.bookingId,
    status: json.status,
    points: null,
    isInstallment: true as const,
    totalKes: Number(json.totalKes),
    balanceKes: Number(json.balanceKes),
    // Go returns a naive "YYYY-MM-DD HH:MM:SS" (UTC, like Prisma's
    // timestamp) — normalise to ISO so the countdown matches.
    balanceDueBy: toIsoUtc(json.balanceDueBy),
    balancePayUrl: `${WEB_URL}/tickets/booking/${json.bookingId}`,
  };
  if (json.paymentError) {
    return { ok: true as const, data, warning: 'Could not start the M-Pesa payment — try again from the trip payment page.' };
  }
  return { ok: true as const, data };
}

function toIsoUtc(naive: string): string {
  const d = new Date(`${naive.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? naive : d.toISOString();
}

/**
 * Pays a portion (or the remaining balance) of an open "lipia pole
 * pole" plan via core-go (payment row + STK there). Works for a guest
 * booking — the booking id is the secret when there's no buyerPartyId,
 * same as actionCheckBookingStatus.
 */
export async function actionPayBookingBalance(raw: unknown) {
  const parsed = payBookingBalanceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Enter an amount' };

  let json: { status: string; balanceKes: string; paymentError?: string };
  try {
    json = await goPost(`/v1/bookings/${parsed.data.bookingId}/balance`, { amountKes: parsed.data.amountKes });
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not start the M-Pesa payment' };
  }
  if (typeof json.status !== 'string') {
    return { ok: false as const, error: 'Could not start the M-Pesa payment' };
  }
  if (json.paymentError) {
    return { ok: false as const, error: 'Could not start the M-Pesa payment' };
  }
  return { ok: true as const, data: { status: json.status, balanceKes: Number(json.balanceKes) } };
}

export interface BookingStatusView {
  id: string;
  status: string;
  points: number | null;
  isInstallment: boolean;
  totalKes: number;
  amountPaidKes: number;
  balanceKes: number;
  balanceDueBy: string | null;
  payments: { amountKes: number; kind: string; status: string; confirmedAt: string | null }[];
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — console mode never visits this. Served by core-go
 *  (GET /v1/bookings/:id/status, the getBookingStatus port). */
export async function actionCheckBookingStatus(bookingId: string): Promise<BookingStatusView | null> {
  try {
    const res = await fetch(`${CORE_GO_URL}/v1/bookings/${bookingId}/status`, {
      headers: { ...(await goAuthHeader()) },
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as { status?: {
      id: string; status: string; points: number | null; isInstallment: boolean;
      totalKes: string; amountPaidKes: string; balanceKes: string; balanceDueBy: string | null;
      payments: { amountKes: string; kind: string; status: string; confirmedAt: string | null }[];
    } } | null;
    const s = json?.status;
    if (!res.ok || !s) return null;
    return {
      id: s.id,
      status: s.status,
      points: s.points,
      isInstallment: s.isInstallment,
      totalKes: Number(s.totalKes),
      amountPaidKes: Number(s.amountPaidKes),
      balanceKes: Number(s.balanceKes),
      balanceDueBy: s.balanceDueBy,
      payments: s.payments.map((p) => ({
        amountKes: Number(p.amountKes), kind: p.kind, status: p.status, confirmedAt: p.confirmedAt,
      })),
    };
  } catch {
    return null;
  }
}

export interface SeatOption {
  id: string;
  label: string;
  status: string;
  ticketClassId: string;
}

async function scheduleSeats(scheduleId: string): Promise<{ seats: SeatOption[] }> {
  const res = await fetch(`${CORE_GO_URL}/v1/schedules/${scheduleId}/seats`, { cache: 'no-store' });
  const json = (await res.json().catch(() => null)) as {
    seats?: { ID: string; Label: string; Status: string; TicketClassID: string }[];
  } | null;
  const seats = ((json?.seats ?? []) as { ID: string; Label: string; Status: string; TicketClassID: string }[]).map(
    (s) => ({ id: s.ID, label: s.Label, status: s.Status, ticketClassId: s.TicketClassID }),
  );
  return { seats };
}

/** Pickable (AVAILABLE) seats for one schedule+class — what the
 *  booking form's seat shortcut uses. */
export async function actionListAvailableSeats(scheduleId: string, ticketClassId: string) {
  const { seats } = await scheduleSeats(scheduleId).catch(() => ({ seats: [] as SeatOption[] }));
  return seats
    .filter((s) => s.status === 'AVAILABLE' && s.ticketClassId === ticketClassId)
    .map((s) => ({ id: s.id, label: s.label }));
}

/** All seats (AVAILABLE and BOOKED) for a schedule, across every
 *  class — what the visual seat picker uses to grey out taken seats
 *  in the actual bus layout instead of just listing what's free. */
export async function actionListScheduleSeats(scheduleId: string) {
  const { seats } = await scheduleSeats(scheduleId).catch(() => ({ seats: [] as SeatOption[] }));
  return seats;
}
