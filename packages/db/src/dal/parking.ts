import {
  normaliseMsisdn,
  normaliseParkingCode,
  mintParkingLotCode,
  mintParkingTicketCode,
  PARKING_TICKET_PREFIX,
} from '@esoqo/domain';
import { prisma } from '../client';
import type { Prisma, ParkingSessionStatus } from '@prisma/client';
import { type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { MAX_PAYMENT_KES } from './business-payment';
import { isUniqueViolation } from './payment-id';

/**
 * Parking: a car park, and the tickets of the cars in it.
 *
 * The public surface here is three steps and a lookup, and it is
 * deliberately the same shape as a parcel tracking code — a printed QR
 * that opens a page, and an unguessable id typed back in:
 *
 *   checkInParking   scan the lot's QR, give a phone number, get a ticket
 *   quoteCheckout    type the ticket, get the price for the stay
 *   createBusinessPayment (parking.ts's caller)  pay that exact price
 *
 * There is no capability on any of it, because a driver at a boom gate
 * is by definition not signed in and cannot be asked to be. What that
 * obliges this file to be strict about is everything else: the lot must
 * be real and open, the number must be a Kenyan mobile, the ticket must
 * be the one the lot issued, and the amount paid must be the amount
 * quoted.
 *
 * What is NOT here, deliberately: a parking-specific money path. The
 * charge is a BusinessPayment to the organisation that runs the lot,
 * which already has an Esoqo Payment ID and a revenue account, so a car
 * park needs no new account kind, no new STK code and no new callback
 * handler. See createBusinessPayment's `parkingSessionId`.
 *
 * And there are deliberately no parking routes in core-go, though most
 * of this product has them there. Parking quote pricing is money: the
 * grace window, the commenced-hours rounding and the daily cap all have
 * to produce the same number in both places or a driver is charged one
 * figure and the ledger books another. One implementation, here, reached
 * over Server Actions from apps/web/src/app/pay/parking/actions.ts, is
 * worth more than a second endpoint that has to be kept in step. If a
 * mobile app or an operator console ever needs this over HTTP, lift
 * *this* file's rules into a shared definition and call the same code —
 * do not retype the arithmetic in Go.
 */

/** A driver cannot be standing in five bays at once. This is a guard
 *  against a double-tapped button or a bored script, not a product
 *  rule: it is set well above the largest family arriving in one
 *  vehicle, and it is per-lot so a legitimate second car at a
 *  different car park is unaffected. */
const MAX_OPEN_SESSIONS_PER_MSISDN = 5;

export class ParkingError extends Error {
  constructor(msg: string, public readonly code:
    | 'LOT_NOT_FOUND' | 'TICKET_NOT_FOUND' | 'INVALID_MSISDN' | 'LOT_CLOSED' | 'ALREADY_CHECKED_OUT' | 'NOT_QUOTED') {
    super(msg);
    this.name = 'ParkingError';
  }
}

/** How long a stay was, and what it costs.
 *
 * Three decisions, each of which is a rule every car park in the country
 * already runs:
 *
 *   · Grace comes off the *front*. Ten minutes free means free for the
 *     first ten minutes, not ten minutes off every hour.
 *   · Hours are commenced, not prorated. Anyone who has driven into a
 *     car park for four minutes past the hour has occupied a bay for
 *     that minute, and every car park in Kenya charges for the started
 *     hour. Prorating would also make a driver who dawdles at the
 *     barrier cheaper than one who cannot, which is backwards.
 *   · A stay inside the grace period owes nothing at all. It is not a
 *     "free hour" and not a minimum of one — it is zero, and the caller
 *     is told so in `billedMinutes`.
 *
 * Exported because the arithmetic is the part worth testing hard: it is
 * where a fifty-shilling mistake becomes a customer's argument at a
 * barrier.
 */
export function quoteParkingStay(args: {
  elapsedMs: number;
  ratePerHourKes: number;
  graceMinutes: number;
  maxPerDayKes?: number | null;
}): { billedMinutes: number; hours: number; amountKes: number; capped: boolean } {
  const { elapsedMs, ratePerHourKes, graceMinutes } = args;
  // A cap of zero is a misconfiguration, not a promotion. Reading it as
  // "free" would turn one unset field into a car park giving its bays
  // away, so a non-positive cap is treated as no cap at all.
  const cap = args.maxPerDayKes && args.maxPerDayKes > 0 ? args.maxPerDayKes : null;

  // Floor, not round: the first thirty-four minutes is not an hour yet.
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  const chargeable = elapsedMinutes - Math.max(0, graceMinutes);
  if (chargeable <= 0) return { billedMinutes: 0, hours: 0, amountKes: 0, capped: false };

  const hours = Math.ceil(chargeable / 60);
  const uncapped = hours * ratePerHourKes;
  const amountKes = cap !== null ? Math.min(uncapped, cap) : uncapped;
  return {
    billedMinutes: chargeable,
    hours,
    amountKes: Math.min(amountKes, MAX_PAYMENT_KES),
    capped: cap !== null && uncapped > cap,
  };
}

/** What a driver is allowed to see about a car park. */
export interface ParkingLotView {
  code: string;
  name: string;
  county: string | null;
  address: string | null;
  ratePerHourKes: number;
  graceMinutes: number;
  maxPerDayKes: number | null;
  /** Whether the lot can take money right now. False when the operating
   *  company has lost its Esoqo Payment ID — a rate is not a promise
   *  the lot can keep, and a driver finding that out at the barrier is
   *  the worst possible moment to learn it. */
  payable: boolean;
}

const lotViewSelect = {
  code: true,
  name: true,
  county: true,
  address: true,
  ratePerHourKes: true,
  graceMinutes: true,
  maxPerDayKes: true,
  party: {
    select: {
      deletedAt: true,
      esoqoPaymentId: { select: { code: true, suspendedAt: true } },
      organisation: { select: { partyId: true } },
    },
  },
} satisfies Prisma.ParkingLotSelect;

type LotRow = Prisma.ParkingLotGetPayload<{ select: typeof lotViewSelect }>;

function toLotView(row: LotRow): ParkingLotView {
  return {
    code: row.code,
    name: row.name,
    county: row.county,
    address: row.address,
    ratePerHourKes: row.ratePerHourKes,
    graceMinutes: row.graceMinutes,
    maxPerDayKes: row.maxPerDayKes,
    payable: Boolean(
      !row.party.deletedAt
      && row.party.esoqoPaymentId
      && !row.party.esoqoPaymentId.suspendedAt
      && row.party.organisation,
    ),
  };
}

/**
 * Resolves a lot from its printed code.
 *
 * Accepts a bare code, a full parking URL, or either in any case, and
 * returns null for an unknown lot rather than throwing — the caller is a
 * page deciding what to show a driver holding a sticker that may be
 * from a car park that has since closed.
 */
export async function findParkingLot(raw: string): Promise<ParkingLotView | null> {
  const code = normaliseParkingCode(raw);
  if (!code) return null;
  const row = await prisma.parkingLot.findUnique({ where: { code }, select: lotViewSelect });
  return row ? toLotView(row) : null;
}

export interface ParkingSessionView {
  ticketCode: string;
  status: 'OPEN' | 'QUOTED' | 'PAID' | 'VOIDED';
  lotName: string;
  lotCode: string;
  plateNo: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  ratePerHourKes: number;
  graceMinutes: number;
  maxPerDayKes: number | null;
  billedMinutes: number | null;
  amountKes: number | null;
  /** Set once the stay has been billed, so the page can show what the
   *  driver was actually charged without recomputing it. */
  hours: number | null;
  receiptCode: string | null;
}

const sessionViewSelect = {
  id: true,
  ticketCode: true,
  status: true,
  plateNo: true,
  checkedInAt: true,
  checkedOutAt: true,
  ratePerHourKes: true,
  graceMinutes: true,
  maxPerDayKes: true,
  billedMinutes: true,
  amountKes: true,
  lot: { select: { name: true, code: true } },
  payment: { select: { receiptCode: true, mpesaReceiptCode: true, status: true } },
} satisfies Prisma.ParkingSessionSelect;

/** Minutes elapsed, for the quote. Kept beside the view so a caller
 *  cannot accidentally bill a session using its own clock. */
function elapsedMs(checkedInAt: Date, now: Date): number {
  return Math.max(0, now.getTime() - checkedInAt.getTime());
}

type SessionRow = Prisma.ParkingSessionGetPayload<{ select: typeof sessionViewSelect }>;

function toSessionView(row: SessionRow): ParkingSessionView {
  const amountKes = row.amountKes === null ? null : Number(row.amountKes);
  return {
    ticketCode: row.ticketCode,
    status: row.status,
    lotName: row.lot.name,
    lotCode: row.lot.code,
    plateNo: row.plateNo,
    checkedInAt: row.checkedInAt.toISOString(),
    checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
    ratePerHourKes: row.ratePerHourKes,
    graceMinutes: row.graceMinutes,
    maxPerDayKes: row.maxPerDayKes,
    billedMinutes: row.billedMinutes,
    amountKes,
    hours: row.billedMinutes === null ? null : Math.ceil(row.billedMinutes / 60),
    receiptCode: row.payment?.receiptCode ?? null,
  };
}

/** What settling a stay needs, and nothing else.
 *
 *  Deliberately not ParkingSessionView: the payee is an internal fact. A
 *  driver has no use for a party uuid and no reason to be shown one, so
 *  the uuid stays on this side of the action boundary and only the
 *  ticket, the lot name and the price travel out. */
export interface ParkingCharge {
  sessionId: string;
  partyId: string;
  lotName: string;
  amountKes: number;
  status: ParkingSessionStatus;
}

const chargeSelect = {
  id: true,
  status: true,
  amountKes: true,
  lot: { select: { partyId: true, name: true } },
} satisfies Prisma.ParkingSessionSelect;

/** The server-side counterpart of getParkingSession, for the checkout
 *  action. Returns null for a ticket that is unknown, unquoted, or free
 *  — a stay inside its grace period owes nothing, so there is no charge
 *  to look up and the caller tells the driver so rather than charging
 *  KES 0 to a card machine. */
export async function resolveParkingCharge(raw: string): Promise<ParkingCharge | null> {
  const code = normaliseParkingCode(raw);
  if (!code || !code.startsWith(`${PARKING_TICKET_PREFIX}-`)) return null;
  const row = await prisma.parkingSession.findUnique({ where: { ticketCode: code }, select: chargeSelect });
  if (!row || row.amountKes === null || Number(row.amountKes) <= 0) return null;
  return {
    sessionId: row.id,
    partyId: row.lot.partyId,
    lotName: row.lot.name,
    amountKes: Number(row.amountKes),
    status: row.status,
  };
}

export interface CheckInInput {
  lotCode: string;
  msisdn: string;
  plateNo?: string | null;
}

/**
 * Parks a car.
 *
 * The rate, the grace period and the daily cap are copied onto the
 * session here and never read off the lot again for this stay. That is
 * the whole reason the columns are duplicated: raising a tariff must
 * not change what a car already parked under, or the figure at checkout
 * is not the figure that was advertised at the gate.
 */
export async function checkInParking(ctx: Ctx, input: CheckInInput): Promise<ParkingSessionView> {
  const code = normaliseParkingCode(input.lotCode);
  if (!code) throw new ParkingError('That car park code is not valid', 'LOT_NOT_FOUND');

  const msisdn = normaliseMsisdn(input.msisdn);
  if (!msisdn) throw new ParkingError('Enter the M-Pesa number to pay with', 'INVALID_MSISDN');

  const lot = await prisma.parkingLot.findUnique({ where: { code } });
  if (!lot) throw new ParkingError('We cannot find that car park', 'LOT_NOT_FOUND');
  if (!lot.active) throw new ParkingError('That car park is not taking cars at the moment', 'LOT_CLOSED');
  if (lot.ratePerHourKes <= 0) throw new ParkingError('That car park has no rate set', 'LOT_CLOSED');

  const open = await prisma.parkingSession.count({
    where: { lotId: lot.id, msisdn, status: { in: ['OPEN', 'QUOTED'] } },
  });
  if (open >= MAX_OPEN_SESSIONS_PER_MSISDN) {
    throw new ParkingError(
      'You already have several tickets open at this car park. Pay for one of them before parking again.',
      'ALREADY_CHECKED_OUT',
    );
  }

  // The unique index is the real guarantee; a collision is a retry, not
  // an error, which is why minting and allocating are separate steps
  // (same split as mintEsoqoCode).
  let sessionId: string | null = null;
  for (let attempt = 0; attempt < 5 && !sessionId; attempt += 1) {
    try {
      const session = await prisma.parkingSession.create({
        data: {
          lotId: lot.id,
          ticketCode: mintParkingTicketCode(),
          msisdn,
          plateNo: input.plateNo?.trim().slice(0, 16).toUpperCase() || null,
          ratePerHourKes: lot.ratePerHourKes,
          graceMinutes: lot.graceMinutes,
          maxPerDayKes: lot.maxPerDayKes,
        },
      });
      sessionId = session.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  if (!sessionId) throw new ParkingError('The car park is busy, try again', 'LOT_CLOSED');

  const row = await prisma.parkingSession.findUnique({ where: { id: sessionId }, select: sessionViewSelect });
  if (!row) throw new ParkingError('We cannot find that car park', 'LOT_NOT_FOUND');

  await recordAudit(ctx, {
    action: 'parking.checked_in',
    targetType: 'parking_session',
    targetId: sessionId,
    payload: { lotCode: code, ticketCode: row.ticketCode },
  });

  return toSessionView(row);
}

/** The stay as it stands, by ticket code. Null for an unknown ticket —
 *  the same "the code is the bearer token" rule a parcel tracking code
 *  follows, and the reason this needs no capability. */
export async function getParkingSession(raw: string): Promise<ParkingSessionView | null> {
  const code = normaliseParkingCode(raw);
  if (!code || !code.startsWith(`${PARKING_TICKET_PREFIX}-`)) return null;
  const row = await prisma.parkingSession.findUnique({ where: { ticketCode: code }, select: sessionViewSelect });
  return row ? toSessionView(row) : null;
}

/**
 * Closes a stay and fixes the price.
 *
 * Idempotent, and that is the important property here rather than a
 * nicety: a driver who taps "check out" twice, or whose first tap landed
 * and whose second tap showed a spinner, must not be billed for a longer
 * stay. Once QUOTED the figure is frozen and every later call returns
 * the same one. A VOIDED ticket is refused outright — a car the lot has
 * written off cannot be quietly turned back into an invoice.
 *
 * Returns the session, whatever state it is in, so a caller can show
 * "you already paid" instead of an error.
 */
export async function quoteParkingCheckout(ctx: Ctx, raw: string, now = new Date()): Promise<ParkingSessionView> {
  const code = normaliseParkingCode(raw);
  if (!code || !code.startsWith(`${PARKING_TICKET_PREFIX}-`)) {
    throw new ParkingError('That ticket code is not valid', 'TICKET_NOT_FOUND');
  }

  const session = await prisma.parkingSession.findUnique({ where: { ticketCode: code } });
  if (!session) throw new ParkingError('We cannot find that ticket', 'TICKET_NOT_FOUND');
  if (session.status === 'VOIDED') throw new ParkingError('That ticket was cancelled by the car park', 'NOT_QUOTED');

  if (session.status === 'OPEN') {
    const quote = quoteParkingStay({
      elapsedMs: elapsedMs(session.checkedInAt, now),
      ratePerHourKes: session.ratePerHourKes,
      graceMinutes: session.graceMinutes,
      maxPerDayKes: session.maxPerDayKes,
    });
    await prisma.parkingSession.update({
      where: { id: session.id },
      data: {
        status: 'QUOTED',
        checkedOutAt: now,
        quotedAt: now,
        billedMinutes: quote.billedMinutes,
        amountKes: quote.amountKes,
      },
    });
    await recordAudit(ctx, {
      action: 'parking.quoted',
      targetType: 'parking_session',
      targetId: session.id,
      payload: { amountKes: quote.amountKes, billedMinutes: quote.billedMinutes },
    });
  }

  const row = await prisma.parkingSession.findUnique({ where: { id: session.id }, select: sessionViewSelect });
  if (!row) throw new ParkingError('We cannot find that ticket', 'TICKET_NOT_FOUND');
  return toSessionView(row);
}

/**
 * A lot's current occupancy and the sessions it has not been paid for.
 *
 * For the operator's own view, and the reason QUOTED-with-no-payment is
 * a first-class state rather than a bug: it is the list of cars that
 * drove away.
 *
 * No Ctx, unlike the functions that write. This is a read of rows that
 * are already scoped to a lot, and taking a context a caller has to
 * construct to prove nothing would be a parameter that exists only to
 * look consistent.
 */
export async function listUnpaidParkingSessions(lotCode: string) {
  const code = normaliseParkingCode(lotCode);
  if (!code) return [];
  const lot = await prisma.parkingLot.findUnique({ where: { code }, select: { id: true } });
  if (!lot) return [];
  return prisma.parkingSession.findMany({
    where: { lotId: lot.id, status: 'QUOTED', payment: null },
    select: sessionViewSelect,
    orderBy: { checkedOutAt: 'desc' },
    take: 100,
  });
}

/** Voids a ticket — a blocked bay, a tow, a mis-keyed check-in. Kept as
 *  a row rather than a delete, because "why does this ticket not work"
 *  needs an answer that survives the conversation. */
export async function voidParkingSession(ctx: Ctx, raw: string, reason: string): Promise<ParkingSessionView> {
  const code = normaliseParkingCode(raw);
  if (!code) throw new ParkingError('That ticket code is not valid', 'TICKET_NOT_FOUND');
  const row = await prisma.parkingSession.update({
    where: { ticketCode: code },
    data: { status: 'VOIDED' },
    select: sessionViewSelect,
  });
  await recordAudit(ctx, {
    action: 'parking.voided',
    targetType: 'parking_session',
    targetId: row.id,
    payload: { reason: reason.slice(0, 140) },
  });
  return toSessionView(row);
}

/**
 * Registers a car park against the organisation that runs it.
 *
 * There is no public caller and no capability check in here because
 * nothing on the customer path creates a lot: a lot is set up once, by
 * somebody who has already been through whatever onboarding its
 * operator went through. Kept in the DAL rather than a script so the
 * rate, the grace period and the cap are written the same way wherever
 * a lot is made — and so the code a lot gets is minted the same way
 * every time, rather than by whichever script ran last.
 */
export async function createParkingLot(ctx: Ctx, input: {
  partyId: string;
  name: string;
  county?: string | null;
  address?: string | null;
  ratePerHourKes: number;
  graceMinutes?: number;
  maxPerDayKes?: number | null;
}): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(input.ratePerHourKes) || input.ratePerHourKes <= 0) {
    throw new ParkingError('A car park needs a rate of at least one shilling an hour', 'LOT_CLOSED');
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const lot = await prisma.parkingLot.create({
        data: {
          partyId: input.partyId,
          code: mintParkingLotCode(),
          name: input.name.trim().slice(0, 80),
          county: input.county?.trim() || null,
          address: input.address?.trim().slice(0, 160) || null,
          ratePerHourKes: input.ratePerHourKes,
          graceMinutes: Math.max(0, Math.trunc(input.graceMinutes ?? 0)),
          maxPerDayKes: input.maxPerDayKes ?? null,
        },
        select: { id: true, code: true },
      });
      await recordAudit(ctx, {
        action: 'parking.lot_created',
        targetType: 'parking_lot',
        targetId: lot.id,
        payload: { code: lot.code, partyId: input.partyId, ratePerHourKes: input.ratePerHourKes },
      });
      return lot;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new ParkingError('Could not allocate a car park code, try again', 'LOT_CLOSED');
}
