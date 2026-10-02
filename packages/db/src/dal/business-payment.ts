import { extractEsoqoId, isGroupKind, normaliseMsisdn, generateTransactionCode, TRANSACTION_CODE_KINDS } from '@esoqo/domain';
import { MpesaError, queryStkPush, type StkQueryResult } from '@esoqo/payments';
import { prisma } from '../client';
import { systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { isUniqueViolation } from './payment-id';
import { issueReceiptFor } from './receipt';
import type { Prisma } from '@prisma/client';

/** How long after the push before it is worth asking Safaricom anything.
 *  Below this the query is refused, and the customer is still deciding. */
export const STK_QUERY_MIN_AGE_MS = 20_000;

/** Shortest gap between two queries about the same payment. Both waiting
 *  screens poll every 2.5s, and every poll asks Safaricom, so without this
 *  a single unpaid prompt becomes a request every 2.5s for as long as the
 *  tab is open — which is how a demo gets an IP rate-limited and then
 *  fails to report real payments too. */
const STK_QUERY_THROTTLE_MS = 15_000;

const lastQueriedAt = new Map<string, number>();

/** Stamp the attempt *before* querying, so even a query that takes thirty
 *  seconds cannot be followed immediately by another one. */
function queryAllowedNow(paymentId: string): boolean {
  const now = Date.now();
  if (now - (lastQueriedAt.get(paymentId) ?? 0) < STK_QUERY_THROTTLE_MS) return false;
  for (const [id, at] of lastQueriedAt) {
    if (now - at > STK_QUERY_THROTTLE_MS) lastQueriedAt.delete(id);
  }
  lastQueriedAt.set(paymentId, now);
  return true;
}

/**
 * Payments made to a business through the public /pay page.
 *
 * The public checkout here looks like StoreOrder and createDonation, and
 * deliberately shares their rules: no capability, because a payer need
 * not be a registered Esoqo subject, and the only secret in the whole
 * flow is the payer's own payment record (getBusinessPayment, below,
 * keyed on an unguessable id).
 *
 * What is different is the direction of the relationship. Everywhere
 * else on Esoqo, a member pays into something the platform runs — a
 * shop's till, a campaign's account. Here a member pays *a business*,
 * which means the business is the account being credited and the payer
 * is the one who may be anonymous. Two consequences run through the
 * code below:
 *
 *   · A payee must be a business that has already been issued an Esoqo
 *     Payment ID (EsoqoPaymentId). That issued code is the "Esoqo
 *     business ID" a customer types or scans, and it is the only thing
 *     that can identify a payee — so findPayableBusinesses refuses
 *     anything without one rather than inventing an identifier, which
 *     is what a derived "ESOQO-<uuid>" would be.
 *   · Nothing here exposes a person's phone number or email to a payer.
 *     The lookup projection carries the business's public details only;
 *     a payer's number appears only on their own payment record.
 */

export class BusinessPaymentError extends Error {
  constructor(msg: string, public readonly code:
    | 'NOT_FOUND' | 'NOT_PAYABLE' | 'AMOUNT_INVALID' | 'INVALID_MSISDN') {
    super(msg);
    this.name = 'BusinessPaymentError';
  }
}

/** Ceiling on one payment. A pay-what-you-want QR has no natural upper
 *  bound, but a fat-fingered or hostile amount is not something an STK
 *  push should be asked to carry — M-Pesa itself caps a single push far
 *  lower, and the failure mode there is an opaque Daraja error. */
export const MAX_PAYMENT_KES = 1_000_000;
const NOTE_MAX = 140;

/** What a payer is allowed to see about the business they're paying. */
export interface PayableBusiness {
  partyId: string;
  /** The issued Esoqo Payment ID — a handle like "johnmutu482". The thing they type or
   *  the thing in the QR. */
  esoqoId: string;
  name: string;
  county: string;
  registrationNo: string | null;
  /** Organisation.kind, so a group's QR can be badged differently from
   *  a shop's. */
  kind: string;
}

/** The one projection every payee read goes through. `include`d by
 *  whichever lookup matched; kept in one place so no caller can
 *  accidentally widen it and start shipping a person's msisdn. */
const payeeSelect = {
  id: true,
  county: true,
  esoqoPaymentId: { select: { code: true, suspendedAt: true } },
  organisation: { select: { kind: true, officialName: true, knownAs: true, registrationNo: true } },
} satisfies Prisma.PartySelect;

type PayableRow = Prisma.PartyGetPayload<{ select: typeof payeeSelect }>;
type BusinessPaymentRow = Prisma.BusinessPaymentGetPayload<Record<string, never>>;

function toPayable(row: PayableRow): PayableBusiness {
  return {
    partyId: row.id,
    esoqoId: row.esoqoPaymentId!.code,
    name: row.organisation!.knownAs || row.organisation!.officialName,
    county: row.county,
    registrationNo: row.organisation!.registrationNo ?? null,
    kind: row.organisation!.kind,
  };
}

/** A payee is an ORGANISATION Party that is alive, has an issued and
 *  unsuspended Esoqo Payment ID, and actually has an Organisation row —
 *  a person holding a Payment ID is not a business anyone can pay. */
function isPayable(row: PayableRow | null): row is PayableRow {
  return Boolean(
    row
    && row.organisation
    && row.esoqoPaymentId
    && !row.esoqoPaymentId.suspendedAt,
  );
}

const PAYABLE_WHERE = {
  deletedAt: null,
  kind: 'ORGANISATION' as const,
  organisation: { isNot: null },
  // `is: { suspendedAt: null }` rather than a bare `isNot: null`: a
  // payment must go to a business whose ID is still live, and mixing
  // `isNot` with a scalar filter on the same relation is not a
  // combinable Prisma filter.
  esoqoPaymentId: { is: { suspendedAt: null } },
};

/**
 * Resolve whatever a customer typed into the businesses they could be
 * paying. Returns a LIST, because a name is not an identifier: "Mama"
 * matches more than one business on most counties' registers, and
 * silently picking the newest would be picking somebody else's till.
 * An Esoqo ID, a phone number or an email resolves to at most one.
 *
 * No capability, like the rest of this file, and the projection is the
 * public one above — a lookup never returns a phone number or email.
 */
export async function findPayableBusinesses(
  ctx: Ctx,
  identifier: string,
  take = 5,
): Promise<PayableBusiness[]> {
  const raw = identifier.trim();
  if (!raw) return [];

  // 1. The Esoqo business ID, typed or scanned. Exact by definition —
  //    the code is unique and verified at issue time.
  const esoqoId = extractEsoqoId(raw);
  if (esoqoId) {
    const row = await prisma.party.findFirst({ where: { ...PAYABLE_WHERE, esoqoPaymentId: { code: esoqoId, suspendedAt: null } }, select: payeeSelect });
    return isPayable(row) ? [toPayable(row)] : [];
  }

  // 2. A phone number. It identifies a *person* — the owner, a member or
  //    an employee of the business — so it resolves through that
  //    person's memberships to the organisations they belong to. A
  //    person with no memberships is not a business you can pay, which
  //    is the honest answer rather than falling back to paying the
  //    person directly.
  //
  //    The filter goes through `organisation.members`, NOT the party's
  //    own `memberships` relation: `Party.memberships` is the set of
  //    groups *this party belongs to*, so filtering on it would match
  //    the person themselves and hand back a PERSON as a payee. The
  //    inverse — the members of a business — is `Organisation.members`.
  const msisdn = normaliseMsisdn(raw);
  if (msisdn) {
    const rows = await prisma.party.findMany({
      where: { ...PAYABLE_WHERE, organisation: { members: { some: { person: { person: { msisdn } }, exitedAt: null, status: 'ACTIVE' } } } },
      select: payeeSelect,
      take,
    });
    return rows.filter(isPayable).map(toPayable);
  }

  // 3. An email, same route as a phone number.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    const rows = await prisma.party.findMany({
      where: { ...PAYABLE_WHERE, organisation: { members: { some: { person: { person: { email: raw } }, exitedAt: null, status: 'ACTIVE' } } } },
      select: payeeSelect,
      take,
    });
    return rows.filter(isPayable).map(toPayable);
  }

  // 4. A name. Substring, case-insensitive, over both the registered
  //    name and the trading name — a customer reads "Mama Mboga
  //    Kitchen" off a sign, not "MAMA MBOGA KITCHEN LTD" off a
  //    register. Several matches is a normal outcome, not an error.
  const rows = await prisma.party.findMany({
    where: {
      ...PAYABLE_WHERE,
      OR: [
        { organisation: { officialName: { contains: raw, mode: 'insensitive' } } },
        { organisation: { knownAs: { contains: raw, mode: 'insensitive' } } },
      ],
    },
    select: payeeSelect,
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.filter(isPayable).map(toPayable);
}

/**
 * What a lookup found, phrased for the customer who typed it.
 *
 * Kept as a discriminated shape rather than a bare [] so the /pay page
 * can tell "no such business" apart from "that business exists but
 * can't take payments" — two very different things to say to someone
 * holding a QR that doesn't work.
 */
export type PayableLookup =
  | { status: 'FOUND'; businesses: PayableBusiness[] }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_PAYABLE' }
  | { status: 'EMPTY' };

export async function lookupPayee(ctx: Ctx, identifier: string): Promise<PayableLookup> {
  const raw = identifier.trim();
  if (!raw) return { status: 'EMPTY' };

  const businesses = await findPayableBusinesses(ctx, raw);
  if (businesses.length > 0) return { status: 'FOUND', businesses };

  // Distinguish "nothing matches at all" from "something matches but
  // cannot receive payments". The second is the common one: a business
  // that registered but never activated a Payment ID.
  const esoqoId = extractEsoqoId(raw);
  if (esoqoId) {
    const anyId = await prisma.esoqoPaymentId.findUnique({ where: { code: esoqoId }, include: { party: { select: { deletedAt: true, esoqoPaymentId: { select: { suspendedAt: true } } } } } });
    if (anyId) return { status: 'NOT_PAYABLE' };
  }
  const msisdn = normaliseMsisdn(raw);
  if (msisdn) {
    const member = await prisma.party.findFirst({ where: { person: { msisdn }, memberships: { some: { exitedAt: null, status: 'ACTIVE' } } }, select: { id: true } });
    if (member) return { status: 'NOT_PAYABLE' };
  }
  return { status: 'NOT_FOUND' };
}

export interface CreateBusinessPaymentInput {
  /** The payee's Party id, from the lookup above. Re-verified here
   *  rather than trusted: it is a client-supplied value, and a payment
   *  row is a financial record. */
  payeePartyId: string;
  amountKes: number;
  payerMsisdn: string;
  payerName?: string | null;
  /** The payer's own Esoqo ID, when they had one to hand. */
  payerEsoqoId?: string | null;
  note?: string | null;
  /** When this payment settles a parking session, the session it settles.
   *
   *  This is the only thing that makes a parking charge a parking
   *  payment — the money path is identical, and deliberately so. But
   *  because a machine quoted that figure rather than the payer choosing
   *  it, `amountKes` is no longer the payer's to set: it is checked
   *  against the session's quoted amount here, in the same place the
   *  payee is re-resolved, so a tampered form cannot bill a car park
   *  whatever it likes. The payee is checked to be the lot's operator
   *  for the same reason. */
  parkingSessionId?: string | null;
}

/**
 * Resolves a number plate to the company that runs that vehicle.
 *
 * The chain is FleetVehicle → TicketOrg → Enterprise → Party, and the
 * party at the end is the one that holds the Esoqo Payment ID and gets
 * the money. Plates are unique per org, not globally, so the same plate
 * can in principle be on two companies' vehicles and both are returned —
 * a driver who types KCB 123A and gets two companies has to be asked
 * which one, not silently shown the first.
 *
 * Matching is case- and space-insensitive because plates are written
 * "KCB 123A" on a windscreen and stored however the operator typed them.
 * A search that misses on a stray space would be the kind of thing that
 * makes a driver conclude their company is not on Esoqo.
 */
export async function lookupPayeeByPlate(raw: string): Promise<PayableLookup> {
  const plate = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (plate.length < 3) return { status: 'NOT_FOUND' };
  // The same van gets written KDA 442Q, KDA442Q and KDA-442Q by three
  // different hands, and a driver types whatever their plate is painted
  // as. Which of those is *stored* is nobody's business — a fleet may
  // have imported one spelling and typed another. So compare with the
  // separators taken out of both sides.
  //
  // That means enumerating where a separator could go in the input, not
  // just deleting the ones that are there: given a compact 'KDA442Q',
  // stripping can only ever produce 'KDA442Q', so a row stored as
  // 'KDA 442Q' would never match. Boundaries are where a letter meets a
  // digit, which is where a separator belongs in Kenyan plates
  // (KDA 442Q, KB 1234, KDG 45A) — no fixed split width assumed, so
  // 'KDA 442Q' and 'KDA442Q' converge on the same answer.
  const bare = plate.replace(/[^A-Z0-9]/g, '');
  if (bare.length < 3) return { status: 'NOT_FOUND' };
  const boundaries: number[] = [];
  for (let i = 1; i < bare.length; i++) {
    const isLetter = (c: string) => c >= 'A' && c <= 'Z';
    if (isLetter(bare[i - 1]!) !== isLetter(bare[i]!)) boundaries.push(i);
  }
  const spacings = new Set<string>();
  // Every subset of the boundaries, doubling per boundary. A plate has at
  // most a handful, and the cap keeps a pathological input from asking
  // for thousands of round trips' worth of OR clauses.
  for (let mask = 0; mask < 2 ** Math.min(boundaries.length, 5); mask++) {
    let out = '';
    for (let i = 0; i < bare.length; i++) {
      if (boundaries.slice(0, 5).includes(i) && (mask >> boundaries.slice(0, 5).indexOf(i)) & 1) out += ' ';
      out += bare[i];
    }
    spacings.add(out);
    spacings.add(out.replace(/ /g, ''));
    spacings.add(out.replace(/ /g, '-'));
  }
  const variants = [...spacings];

  const vehicles = await prisma.fleetVehicle.findMany({
    where: { OR: variants.map((v) => ({ plateNo: { equals: v, mode: 'insensitive' } })) },
    select: {
      plateNo: true,
      org: {
        select: {
          vertical: true,
          name: true,
          enterprise: { select: { party: { select: payeeSelect } } },
        },
      },
    },
    take: 10,
  });

  const parties = new Map<string, PayableBusiness>();
  for (const v of vehicles) {
    const row = v.org.enterprise.party;
    if (isPayable(row)) parties.set(row.id, toPayable(row));
  }
  if (parties.size === 0) return { status: 'NOT_FOUND' };
  return { status: 'FOUND', businesses: [...parties.values()] };
}

/**
 * findPayableBusinesses, narrowed to kinds that are groups.
 *
 * A separate entry point rather than an option on the general lookup,
 * because /pay/group and /pay/business are different promises: someone
 * on "pay a group" who is offered a shop has been sent to the wrong page,
 * and the fix is a filter that lives with the page that needs it, not a
 * flag every future caller has to remember to pass.
 *
 * The take is raised before filtering, not after, so a county with five
 * "Mama" kitchens ahead of the one chama is not an empty result. A name
 * that matches more than 25 registered payees is not a search anybody
 * was going to read, and the UI says so.
 */
export async function findPayableGroups(ctx: Ctx, identifier: string, take = 5): Promise<PayableBusiness[]> {
  const all = await findPayableBusinesses(ctx, identifier, 25);
  return all.filter((b) => isGroupKind(b.kind)).slice(0, take);
}

export async function createBusinessPayment(ctx: Ctx, input: CreateBusinessPaymentInput) {
  const row = await prisma.party.findFirst({
    where: { id: input.payeePartyId, ...PAYABLE_WHERE },
    select: payeeSelect,
  });
  if (!isPayable(row)) {
    throw new BusinessPaymentError('That business cannot receive payments', 'NOT_PAYABLE');
  }

  const amount = Number(input.amountKes);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_KES) {
    throw new BusinessPaymentError(
      `Enter an amount above zero and below KES ${MAX_PAYMENT_KES.toLocaleString('en-KE')}`,
      'AMOUNT_INVALID',
    );
  }

  // A parking charge is quoted, not chosen. Resolve the session before
  // the payee so a wrong amount is reported as what it is, and refuse
  // before anything is written rather than after.
  let parkingSession: { id: string; amountKes: unknown; lotPartyId: string } | null = null;
  if (input.parkingSessionId) {
    parkingSession = await prisma.parkingSession.findUnique({
      where: { id: input.parkingSessionId },
      select: { id: true, amountKes: true, lot: { select: { partyId: true } } },
    }).then((s) => (s ? { id: s.id, amountKes: s.amountKes, lotPartyId: s.lot.partyId } : null));
    if (!parkingSession) {
      throw new BusinessPaymentError('That parking ticket does not exist', 'NOT_FOUND');
    }
    if (parkingSession.lotPartyId !== input.payeePartyId) {
      throw new BusinessPaymentError('That parking ticket belongs to a different car park', 'NOT_PAYABLE');
    }
    // Compared in shillings: the quote is whole shillings by
    // construction, and a decimal that is a hair over or under is a
    // rounding artefact, not a different price.
    if (Number(parkingSession.amountKes) !== amount) {
      throw new BusinessPaymentError(
        'The parking price has changed. Check the amount and try again.',
        'AMOUNT_INVALID',
      );
    }
  }

  const payerMsisdn = normaliseMsisdn(input.payerMsisdn);
  if (!payerMsisdn) {
    throw new BusinessPaymentError('Enter the M-Pesa number to pay from', 'INVALID_MSISDN');
  }

  const note = input.note?.trim().slice(0, NOTE_MAX) || null;
  const payerEsoqoId = input.payerEsoqoId ? extractEsoqoId(input.payerEsoqoId) || null : null;

  const payment = await prisma.businessPayment.create({
    data: {
      payeePartyId: row.id,
      payeeEsoqoId: row.esoqoPaymentId!.code,
      payeeName: row.organisation!.knownAs || row.organisation!.officialName,
      payerMsisdn,
      payerName: input.payerName?.trim() || null,
      payerEsoqoId,
      amountKes: amount,
      note,
      parkingSessionId: parkingSession?.id ?? null,
    },
  });

  await recordAudit(ctx, {
    action: 'business_payment.created',
    targetType: 'business_payment',
    targetId: payment.id,
    payload: {
      payeePartyId: row.id, payeeEsoqoId: row.esoqoPaymentId!.code,
      amountKes: amount, payerEsoqoId,
      ...(parkingSession ? { parkingSessionId: parkingSession.id } : {}),
    },
  });
  return payment;
}

/**
 * Stamps the Daraja CheckoutRequestID onto a payment right after the STK
 * push is accepted. Until this lands the callback cannot find the row
 * it is confirming, which is why the /pay action creates the payment
 * *before* it pushes rather than after.
 */
export async function attachBusinessPaymentCheckoutRequestId(paymentId: string, checkoutRequestId: string) {
  return prisma.businessPayment.update({
    where: { id: paymentId },
    data: { mpesaCheckoutRequestId: checkoutRequestId },
  });
}

async function businessRevenueAccountId(tx: Prisma.TransactionClient, payeePartyId: string): Promise<string> {
  const existing = await tx.account.findFirst({
    where: { partyId: payeePartyId, kind: 'BUSINESS_REVENUE', currency: 'KES' },
  });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { partyId: payeePartyId, kind: 'BUSINESS_REVENUE', currency: 'KES' },
  });
  return created.id;
}

async function settlementAccountId(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.account.findFirst({
    where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' },
  });
  if (existing) return existing.id;
  const created = await tx.account.create({
    data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' },
  });
  return created.id;
}

export interface BusinessPaymentNotifyInfo {
  payerMsisdn: string;
  payerName: string | null;
  amountKes: number;
  businessName: string;
  /** The payee's issued Esoqo ID, so the payer can be given a link back
   *  to the payment page without a second lookup. */
  payeeEsoqoId: string;
  receiptCode: string;
  /** Safaricom's own M-Pesa receipt code, when there is one. Distinct
   *  from `receiptCode` above and not interchangeable: this is the code on
   *  the payer's M-Pesa statement, which is what a business reconciles
   *  against. Null on the console provider and on a callback that
   *  arrived without one, so callers must treat it as optional. */
  mpesaReceiptCode: string | null;
  /** The payee's members who can be texted, office-holders first. Empty
   *  is normal and not an error — a business may have no member with a
   *  number on file, and the money is still posted. */
  businessMsisdns: string[];
  /** Set only when this payment settled a parking stay, so the caller
   *  sends a parking receipt instead of a business one. Carries only what
   *  that receipt needs: the ticket is deliberately absent, because the
   *  driver spent it at the barrier and repeating it helps nobody. */
  parking?: { lotName: string };
  /** The Receipt this payment minted (see issueReceiptFor in
   *  dal/receipt.ts) — null for a parking payment, which never mints
   *  one, or on the rare case the mint itself failed. Feeds
   *  payerPaymentReceiptSms's receiptVerifyCode. */
  receiptVerifyCode: string | null;
}

export interface ConfirmBusinessPaymentResult {
  payment: Awaited<ReturnType<typeof prisma.businessPayment.update>>;
  /** False on an idempotent replay — Safaricom delivers the same
   *  callback more than once, and nobody should be thanked twice for
   *  one payment. */
  justConfirmed: boolean;
  notify?: BusinessPaymentNotifyInfo;
}

const ROLE_RANK: Record<string, number> = { CHAIRPERSON: 0, TREASURER: 1, SECRETARY: 2, MEMBER: 3, OTHER: 4 };

/**
 * Called from the M-Pesa callback handler (SYSTEM ctx, never a request
 * ctx) — or, in console mode where there is no callback, immediately
 * after the push.
 *
 * Idempotent, exactly as confirmDonationPayment is: the JournalEntry's
 * idempotencyKey is the checkoutRequestId, so a repeated callback finds
 * the entry already there and posts nothing. That guard is what makes it
 * safe to call from both the webhook and a retry.
 *
 * Posts the payee's own BUSINESS_REVENUE account +amount against the
 * platform SETTLEMENT account -amount — a plain balanced two-line entry,
 * no fee split, matching Donation. The business's revenue from QR
 * payments stays separable from its till revenue, which is the whole
 * reason this gets its own AccountKind.
 */
export async function confirmBusinessPayment(
  checkoutRequestId: string,
  mpesaReceiptCode: string,
): Promise<ConfirmBusinessPaymentResult> {
  const payment = await prisma.businessPayment.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: {
      payeeParty: {
        include: {
          // `organisation.members`, not `party.memberships`: the business's
          // own members are the inverse of the groups a party belongs to,
          // and an organisation has no memberships of its own. Reading
          // the wrong side silently yields an empty recipient list, i.e.
          // a paid business that is never told.
          organisation: {
            include: {
              members: {
                where: { exitedAt: null, status: 'ACTIVE', person: { person: { msisdn: { not: null } } } },
                include: { person: { include: { person: { select: { msisdn: true } } } } },
              },
            },
          },
        },
      },
      // Only ever non-null for a parking charge, and only so the caller
      // can text a driver a parking receipt rather than a business one.
      parkingSession: { select: { lot: { select: { name: true } } } },
    },
  });
  if (!payment) throw new BusinessPaymentError('No business payment matches this payment', 'NOT_FOUND');
  if (payment.status !== 'PENDING') {
    // A late callback still carries Safaricom's receipt code, and the
    // status query never can: Daraja's query response is
    // {ResponseCode, ResultCode, ResultDesc} with no CallbackMetadata at
    // all, so a payment settled by the query fallback has no M-Pesa code
    // and this callback may be the only copy that will ever arrive. Take
    // it rather than dropping the last chance to complete the record.
    // No ledger movement and no notification — the payment is already
    // settled and already announced.
    if (payment.status === 'CONFIRMED' && mpesaReceiptCode && !payment.mpesaReceiptCode) {
      return {
        payment: await prisma.businessPayment.update({
          where: { id: payment.id },
          data: { mpesaReceiptCode },
        }),
        justConfirmed: false,
      };
    }
    return { payment, justConfirmed: false };
  }

  const amount = Number(payment.amountKes);

  // Thrown to abandon the transaction when another confirmer got there
  // first. Rolling back is the point: the loser must leave no journal
  // entry behind, or one payment would post twice.
  const LOST_RACE = Symbol('business payment already confirmed');

  // Re-rolled on each attempt: a receiptCode collision (astronomically
  // unlikely at 31^5 entropy, but the unique constraint is the real
  // guarantee, not the odds) must retry with a *new* code, not the same
  // one — same "let the database arbitrate" rule allocateEsoqoCode
  // follows for Esoqo Payment IDs.
  let code = '';
  let updated: ConfirmBusinessPaymentResult['payment'] | undefined;
  for (let attempt = 0; attempt < 5 && !updated; attempt++) {
    code = generateTransactionCode(TRANSACTION_CODE_KINDS.BUSINESS_PAYMENT);
    try {
      updated = await prisma.$transaction(async (tx) => {
      // Claim the row before anything else, atomically. Two paths can now
      // confirm the same payment at the same moment — Safaricom's callback
      // and the waiting screen's own status query — and a read-then-write
      // is not enough to stop both, because both can read PENDING. The
      // status in the WHERE clause is the lock: exactly one update can
      // match, so exactly one caller can post the entry and send the
      // receipt. The loser finds nothing to update and is told so.
      const claimed = await tx.businessPayment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          mpesaReceiptCode: mpesaReceiptCode || null,
          receiptCode: code,
        },
      });
      if (claimed.count === 0) throw LOST_RACE;

      const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: checkoutRequestId } });
      let entryId = existingEntry?.id;
      if (!entryId) {
        const [revenue, settlement] = await Promise.all([
          businessRevenueAccountId(tx, payment.payeePartyId),
          settlementAccountId(tx),
        ]);
        const entry = await tx.journalEntry.create({
          data: {
            reference: `BUSINESS-PAYMENT-${payment.id}`,
            description: `Payment to ${payment.payeeName}`,
            idempotencyKey: checkoutRequestId,
            postings: {
              create: [
                { accountId: revenue, amount },
                { accountId: settlement, amount: -amount },
              ],
            },
          },
        });
        entryId = entry.id;
      }
      return tx.businessPayment.update({
        where: { id: payment.id },
        data: { journalEntryId: entryId },
      }).then(async (updated) => {
      // A parking session is settled by the payment being confirmed, in
      // the same transaction, so "the car has paid" and "the ledger has
      // the entry" cannot be separately true. Reached only from here:
      // nothing else may set PAID, which is what makes it mean money
      // moved rather than "an attendant clicked something".
      if (payment.parkingSessionId) {
        await tx.parkingSession.update({
          where: { id: payment.parkingSessionId },
          data: { status: 'PAID' },
        });
      }
      return updated;
      });
      });
    } catch (e) {
      if (e === LOST_RACE) {
        // Someone else confirmed this payment first — almost always the
        // callback arriving while our own status query was in flight.
        // Report the replay honestly so no second receipt goes out.
        const settled = await prisma.businessPayment.findUnique({ where: { id: payment.id } });
        return { payment: settled!, justConfirmed: false };
      }
      if (isUniqueViolation(e) && attempt < 4) continue; // receiptCode collision — re-roll and retry
      throw e;
    }
  }
  if (!updated) throw new Error('Could not confirm this payment — try again');

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'business_payment.confirmed',
    targetType: 'business_payment',
    targetId: payment.id,
    payload: { mpesaReceiptCode, payeePartyId: payment.payeePartyId, amountKes: amount },
  });

  const businessMsisdns = [...(payment.payeeParty.organisation?.members ?? [])]
    .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9))
    .map((m) => m.person?.person?.msisdn)
    .filter((n): n is string => Boolean(n))
    .filter((n, i, all) => all.indexOf(n) === i)
    .slice(0, 5);

  // Parking never mints a Receipt — it settles through parkingPaidSms
  // instead (see the doc comment on receiptVerifyCode). Everything else
  // does, and gets storeId attributed when the payee maps to exactly
  // one ACTIVE store — the case that also makes it itemizable from that
  // store's dashboard (see listReceiptsNeedingItems in dal/receipt.ts).
  let receiptVerifyCode: string | null = null;
  if (!payment.parkingSessionId) {
    const stores = await prisma.store.findMany({
      where: { status: 'ACTIVE', enterprise: { partyId: payment.payeePartyId } },
      select: { id: true },
    });
    try {
      const receipt = await issueReceiptFor({
        storeId: stores.length === 1 ? stores[0]!.id : null,
        businessPaymentId: payment.id,
        totalKes: amount,
        buyerMsisdn: payment.payerMsisdn,
      });
      receiptVerifyCode = receipt.receiptCode ?? null;
    } catch (e) {
      // Best-effort, deliberately: the payment and its BP-kind
      // receiptCode above are already durably confirmed. A Receipt is
      // an added courtesy (the verify link, the itemization list) — its
      // failure must never roll back or re-throw into a webhook retry.
      recordAudit(systemCtx('mpesa-callback'), {
        action: 'business_payment.receipt_failed', targetType: 'business_payment', targetId: payment.id,
        payload: { error: e instanceof Error ? e.message : String(e) },
      }).catch(() => {});
    }
  }

  return {
    payment: updated,
    justConfirmed: true,
    notify: {
      payerMsisdn: payment.payerMsisdn,
      payerName: payment.payerName,
      amountKes: amount,
      businessName: payment.payeeName,
      payeeEsoqoId: payment.payeeEsoqoId,
      receiptCode: code,
      mpesaReceiptCode: mpesaReceiptCode || null,
      businessMsisdns,
      receiptVerifyCode,
      ...(payment.parkingSession
        ? { parking: { lotName: payment.parkingSession.lot.name } }
        : {}),
    },
  };
}

/**
 * The counterpart to confirmBusinessPayment: Safaricom reported the push
 * did NOT succeed (cancelled, insufficient balance, a timeout). Idempotent
 * the same way — a repeated callback for an already-terminal payment is a
 * no-op, and a payment that is already CONFIRMED is never walked back to
 * FAILED by a late failure callback.
 */
export async function failBusinessPayment(checkoutRequestId: string, reason: string) {
  const payment = await prisma.businessPayment.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
  });
  if (!payment) throw new BusinessPaymentError('No business payment matches this payment', 'NOT_FOUND');
  return markFailed(payment, reason);
}

/**
 * The same thing, for a payment whose STK push never came back.
 *
 * createBusinessPayment persists BEFORE the push is attempted, which is
 * what stops a crash between the two from losing a payment the customer
 * believes they made. The cost of that ordering is a row that can end
 * up PENDING with no checkoutRequestId attached — the push threw — and
 * failBusinessPayment, which keys off that id, cannot see it. Such a
 * payment would sit PENDING forever, counting as unsettled revenue for a
 * transaction that never reached Safaricom.
 *
 * Idempotent, and never walks a CONFIRMED payment back to FAILED.
 */
export async function failBusinessPaymentById(paymentId: string, reason: string) {
  const payment = await prisma.businessPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new BusinessPaymentError('No business payment matches this payment', 'NOT_FOUND');
  return markFailed(payment, reason);
}

async function markFailed(payment: BusinessPaymentRow, reason: string): Promise<BusinessPaymentRow> {
  if (payment.status !== 'PENDING') return payment;

  const updated = await prisma.businessPayment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
  });

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'business_payment.failed',
    targetType: 'business_payment',
    targetId: payment.id,
    payload: { reason, payeePartyId: payment.payeePartyId },
  });
  return updated;
}

/**
 * One payment, for the payer's own waiting/receipt screen. No capability
 * and no owner check — the payment id is the secret, the same contract
 * as getOrder and getDonation. Returns only the fields a payer may see;
 * the payer's name and note are already theirs, and the payee's contact
 * details are not on this row at all.
 */
export async function getBusinessPayment(paymentId: string) {
  return prisma.businessPayment.findUnique({ where: { id: paymentId } });
}

/**
 * Ask Safaricom what happened to a payment we have not heard back about.
 *
 * The callback is the primary way a payment settles, and it is a request
 * from Safaricom's servers into a URL that in local development is a
 * laptop behind a free tunnel. That leg breaks — and while it is broken
 * the payment is PENDING forever and the payer is told nothing, which is
 * worse than a clear failure: the money may well have been taken.
 *
 * So the waiting screen asks Safaricom directly instead. Both settle
 * paths are already idempotent (confirm keys on the checkout id, and
 * markFailed refuses to touch a non-PENDING row), which is what makes
 * this safe to run on every poll and safe to run twice.
 *
 * The verdict is deliberately narrow. COMPLETED and FAILED are only ever
 * returned when Safaricom says so; "we could not find out" stays PENDING
 * and is the caller's to word. Turning a transport problem into a FAILED
 * payment would tell a customer their money did not move when it did, and
 * they would pay twice.
 */
export async function reconcileBusinessPayment(
  paymentId: string,
  opts: { minAgeMs?: number } = {},
): Promise<{
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  reason?: string;
  /** Present only on the poll that actually settled the payment, so the
   *  caller can send the receipt. `confirmBusinessPayment` reports
   *  justConfirmed once — a later callback or poll replays into the same
   *  journal entry and comes back false — which is what stops a shopper
   *  being thanked twice for one payment. */
  confirmed?: ConfirmBusinessPaymentResult;
}> {
  const minAgeMs = opts.minAgeMs ?? STK_QUERY_MIN_AGE_MS;
  const payment = await prisma.businessPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { status: 'PENDING' };
  if (payment.status !== 'PENDING') return { status: payment.status };
  if (!payment.mpesaCheckoutRequestId) return { status: 'PENDING' };

  // Too early. Daraja refuses a query issued seconds after the push, and
  // a customer is still reading the prompt at this point.
  if (Date.now() - payment.createdAt.getTime() < minAgeMs) return { status: 'PENDING' };

  // Asked very recently — a browser poll 2.5s ago already did this.
  if (!queryAllowedNow(payment.id)) return { status: 'PENDING' };

  let answer: StkQueryResult;
  try {
    answer = await queryStkPush(payment.mpesaCheckoutRequestId);
  } catch (e) {
    // Console mode has nothing to ask; a Daraja outage must not turn into
    // a failed payment. Leave the row alone and let the caller keep
    // waiting — an unanswered question is not a "no".
    if (!(e instanceof MpesaError)) throw e;
    return { status: 'PENDING' };
  }

  if (answer.state === 'COMPLETED') {
    const confirmed = await confirmBusinessPayment(
      payment.mpesaCheckoutRequestId!,
      answer.mpesaReceiptCode ?? '',
    );
    return { status: 'CONFIRMED', confirmed };
  }
  if (answer.state === 'FAILED') {
    await markFailed(payment, answer.resultDescription);
    return { status: 'FAILED', reason: answer.resultDescription };
  }
  return { status: 'PENDING' };
}
