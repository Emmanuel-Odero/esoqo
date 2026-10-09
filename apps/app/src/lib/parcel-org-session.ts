import { cookies } from "next/headers";
import { cache } from "react";
import { goUrl } from "./ticketing";

/**
 * The courier-company portal's session.
 *
 * Deliberately thinner than the ticket-staff one beside it: this cookie
 * carries core-go's bearer token and nothing else, and no page here
 * decodes a session or reasons about capabilities in Node. Every read
 * and write goes to core-go with the bearer attached, and core-go —
 * which owns the ParcelOrgID scoping and the capability bundles — is
 * the single authority on what this login may see.
 *
 * That is a deliberate departure from how /org/[orgId] works, not an
 * oversight. Mirroring a capability model across two languages is how
 * the two drift, and a portal that renders a button its server will
 * then refuse is worse than one that asks first. The cost is a round
 * trip per page; the benefit is exactly one place where "whose parcels
 * are these" is decided.
 *
 * Its own cookie name for the same reason TICKET_STAFF_SESSION_COOKIE
 * has one: a rider signing in on a shared phone must not clobber the
 * owner's Esoqo session, or vice versa.
 */

export const PARCEL_ORG_SESSION_COOKIE = "esoqo_parcel_org_session";

// 12 hours — a shift, matching the TTL core-go mints the session with.
// A longer cookie than the session behind it would only produce a
// browser that thinks it's signed in and a server that disagrees.
const PARCEL_ORG_SESSION_TTL = 60 * 60 * 12;

export async function setParcelOrgSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(PARCEL_ORG_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PARCEL_ORG_SESSION_TTL,
    path: "/",
  });
}

export async function clearParcelOrgSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(PARCEL_ORG_SESSION_COOKIE);
}

export async function parcelOrgToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PARCEL_ORG_SESSION_COOKIE)?.value ?? null;
}

/** Distinguishes "you aren't signed in" from "that failed", because the
 *  two need different handling: one redirects, the other shows an error
 *  without throwing the person out of a shift mid-task. */
export class ParcelOrgUnauthorised extends Error {
  constructor() {
    super("Not signed in to a courier company");
    this.name = "ParcelOrgUnauthorised";
  }
}

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * A core-go rejection that kept its error code.
 *
 * The code used to be dropped here and only the prose survived, which
 * forced callers that needed to branch on *which* failure it was to
 * match the message text — see packages/ui/src/parcelOfflineQueue.ts,
 * which regexed the wording of a spent-label error to decide whether a
 * replayed offline booking had in fact succeeded. That made a copy-edit
 * in a Go string a silent client break. The code is the contract; this
 * class is how it reaches the caller.
 */
export class ParcelOrgRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ParcelOrgRequestError";
    this.code = code;
  }
}

/**
 * Codes that genuinely mean "this session is no good" as opposed to
 * "this session may not do that to that thing".
 *
 * The distinction matters because core-go returns 403 for both, and
 * treating the status alone as a session verdict turned every domain
 * refusal into "your shift session has expired". A clerk told that
 * would sign out, sign back in, and hit exactly the same wall — with
 * the one sentence that would have explained it ("You aren't holding
 * this parcel", "This parcel is assigned to another collector")
 * discarded on the way through. See dbx's ParcelError codes, which are
 * all mapped to 403 by parcelErrorStatus.
 */
const SESSION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "SESSION_LOOKUP_FAILED",
  "DENIED",
]);

/**
 * Calls core-go with the portal's bearer attached.
 *
 * A dead or insufficient SESSION becomes ParcelOrgUnauthorised, so the
 * caller can redirect to the company's own door. Anything else — the
 * parcel refusing the operation, a label already spent, a run that has
 * left — comes back as a ParcelOrgRequestError carrying core-go's own
 * code and prose, because those are answers the person at the desk can
 * act on and a redirect would throw away.
 */
export async function parcelOrgFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await parcelOrgToken();
  if (!token) throw new ParcelOrgUnauthorised();

  const res = await fetch(goUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (res.status === 401 || res.status === 403) {
    const code = json?.error?.code ?? "";
    // No code at all is treated as a session failure: that is what a
    // proxy or an edge 403 with no JSON body looks like, and "sign in
    // again" is the safer guess when the server said nothing.
    if (!code || SESSION_ERROR_CODES.has(code)) throw new ParcelOrgUnauthorised();
    throw new ParcelOrgRequestError(
      code,
      json?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  if (!res.ok || !json) {
    throw new ParcelOrgRequestError(
      json?.error?.code ?? `HTTP_${res.status}`,
      json?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

// ── Wire types, matching core-go's handlers_parcel_orgs.go ───────────

export interface ParcelOrgSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Co-branded label logo. Null = Esoqo branding alone. */
  logoUrl?: string | null;
  brandAccent?: string | null;
}

export interface ParcelOrgStats {
  awaitingPickup: number;
  inTransit: number;
  failedDeliveries: number;
  atAgent: number;
  deliveredToday: number;
  // Decimal strings from core-go — parse with toCents from @esoqo/domain.
  earningsTodayKes: string;
  earningsKes: string;
  /** Booked, self-drop-off parcels nobody here has received yet — a
   *  subset of awaitingPickup, broken out because it means "a sender is
   *  walking in", not "waiting on our own rider". */
  awaitingDropoff: number;
  /** Active parcels past their SLA deadline — powers the register's
   *  "Overdue only" toggle and the attention band. */
  overdue: number;
  /** Counter cash a clerk has taken and a manager hasn't counted in yet
   *  (see RemitCounterCash) — sitting with the company, not Esoqo,
   *  until that happens. */
  counterCashOutstandingKes: string;
  /** Esoqo's own cut of counterCashOutstandingKes — the company's own
   *  share of that cash is theirs; this slice is Esoqo's, pending. */
  counterCashPlatformFeeOwedKes: string;
  /** Counter tickets still in the queue, unclaimed — a sender who's
   *  checked in but no clerk has picked up their case yet. This is the
   *  live "someone's waiting" count; awaitingDropoff no longer is, now
   *  that a self-drop-off sender can't mint a BOOKED parcel without a
   *  clerk going through the counter queue first. */
  waitingTickets: number;
}

export interface OrgParcelRow {
  id: string;
  code: string;
  status: string;
  receiverName: string;
  receiverMsisdn: string;
  originLabel: string;
  destinationLabel: string;
  parcelType: string;
  orgEarningsKes: string | null;
  createdAt: string;
  slaDeadlineAt: string | null;
  deliveryAttempts: number;
  lastAttemptReason: string | null;
  holderName: string | null;
  agentName: string | null;
  originMethod: string;
  /** The company's own number from the system it imported this parcel
   *  from, when it brought one. Null for Esoqo-booked parcels. */
  externalRef: string | null;
  externalSource: string | null;

  /** Receiver self-authentication, for the escalation queue. A receiver
   *  proving from their own phone that they are the receiver, by typing
   *  the delivery code — three tries, then `receiverAuthLockedAt` and
   *  this desk is texted. Staff may allow two more; burning those sets
   *  `receiverAuthHardLockedAt`, which only a reissued code clears.
   *
   *  No delivery code here, current or otherwise: the console shows
   *  that a parcel is stuck and offers the verbs, and the code itself
   *  only ever reaches the sender and the receiver, by SMS. */
  receiverAuthAttempts: number;
  receiverAuthLockedAt: string | null;
  receiverAuthHardLockedAt: string | null;
  deliveryCodeVersion: number;
  /** Set when a receiver closed their own collection at a pickup point.
   *  The courier's pay waits out a hold instead of accruing on the spot,
   *  because no member of staff witnessed the handover. */
  courierEarningsHeldUntil: string | null;
  /** Payment state (never the amount). PAY_AT_COUNTER parcels are
   *  BOOKED / on the shelf before they're paid, so `paid` — not status —
   *  is what says the fare still has to be collected. A receipt means
   *  it was paid by M-Pesa prompt rather than cash. */
  paymentMethod: string | null;
  paid: boolean;
  mpesaReceiptCode: string | null;
  /** An M-Pesa prompt is out and not yet paid. */
  paymentPending: boolean;
}

export interface ParcelOrgMe {
  org: ParcelOrgSummary;
  stats: ParcelOrgStats;
  capabilities: string[];
  /**
   * Whether this login can physically hold a parcel.
   *
   * False for a roster row with no linked partyId — an office-only
   * login. core-go's ScanHandoff deliberately leaves
   * currentHolderPartyId untouched for those (there is no Party to
   * attribute custody to), and DeliverParcel refuses anyone who isn't
   * the current holder. So such a login can receive boxes all day and
   * never hand one over. The scanner reads this up front and says what
   * to fix, rather than letting it surface as a FORBIDDEN on the last
   * step with a receiver standing at the counter.
   *
   * Optional so a portal talking to a core-go that predates the field
   * still renders — undefined is treated as "assume capable", which is
   * the pre-existing behaviour.
   */
  custodyCapable?: boolean;
}

/** One day of the trailing-7-day operations trend. Mirrors
 *  dbx.DailyBucket — booked vs delivered per Nairobi day. */
export interface ParcelOrgTrendDay {
  day: string;
  booked: number;
  delivered: number;
}

/** One of the company's own vehicle runs that is still loading —
 *  what the counter's "receive and load" picker chooses between.
 *  Mirrors dbx.OrgShipment. */
export interface OrgShipment {
  id: string;
  originLabel: string;
  destinationLabel: string;
  routeLabel: string;
  vehiclePlate: string;
  status: string;
  loaded: number;
  createdAt: string;
}

/** The session profile, fetched once per request. The layout calls this
 *  for the nav chrome and every child page calls it again for its own
 *  content — React's cache() unifies those into a single round trip to
 *  core-go instead of the two each page used to make. */
export const getParcelOrgMe = cache(async (): Promise<ParcelOrgMe> => {
  return parcelOrgFetch<ParcelOrgMe>("/v1/parcel-orgs/me");
});

/** A scanned/typed label resolved against the company's own stock.
 *  Mirrors dbx.OrgParcelLabel. */
export interface OrgParcelLabel {
  code: string;
  state: string;
  itemDescription: string | null;
  destination: string | null;
  senderName: string | null;
  senderMsisdn: string | null;
  receiverName: string | null;
  receiverMsisdn: string | null;
  /** Field measurements carried into a counter booking rather than
   *  re-asked — same contract as the admin label-info read. */
  itemType: string | null;
  weightRangeKg: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  usedAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  parcelId: string | null;
  parcelCode: string | null;
  parcelStatus: string | null;
  batchId: string | null;
  /** QR signature so a resolved label reprints genuine. */
  sig: string;
}

/** One spendable sticker from the company's own pad, as the
 *  custom-parcel label picker lists it. Mirrors
 *  dbx.OrgLabelSearchRow. */
export interface OrgLabelSearchRow {
  code: string;
  createdAt: string;
}

export interface ParcelOrgStaffRow {
  id: string;
  orgId: string;
  name: string;
  role: string;
  active: boolean;
  /** One of the company's contact people (multiple allowed). */
  isContact: boolean;
  partyId: string | null;
  stationId: string | null;
  /** The phone and the esoqo handle this member signs in with — read
   *  back to someone who forgot, and shown so a manager can see a
   *  credential exists. Both null for an office-only login with no
   *  linked person. */
  msisdn: string | null;
  esoqoId: string | null;
  /** A custom ("Other…") role's explicit permissions. Empty for a preset
   *  role, whose bundle is resolved from `role` at sign-in. */
  capabilities: string[];
}

export interface ParcelOrgStationRow {
  id: string;
  name: string;
  msisdn: string;
  locationHint: string;
  openingHours: string | null;
  lat: number;
  lng: number;
  capacity: number;
  active: boolean;
  /** The roster member who runs this station, if named. */
  managerStaffId: string | null;
  /** How many team members are currently posted here. */
  memberCount: number;
}

/** One person aboard a dispatch run. Mirrors dbx.DispatchCrew —
 *  roleLabel is server-rendered ("Tout", or the custom title). */
export interface DispatchCrew {
  id: string;
  name: string;
  msisdn: string | null;
  role: string;
  customRole: string | null;
  staffId: string | null;
  roleLabel: string;
}

/** One of the receiving team waiting at the destination to check the
 *  run in on arrival. Mirrors dbx.DispatchReceiver. */
export interface DispatchReceiver {
  id: string;
  name: string;
  staffId: string | null;
}

export interface DispatchStation {
  id: string;
  name: string;
  locationHint: string;
  lat: number;
  lng: number;
}

export interface DispatchPing {
  lat: number;
  lng: number;
  at: string;
}

/** One run of one of the company's own vehicles. Mirrors dbx.Run.
 *
 *  Since ADR-0006 this is the WHOLE run: plate, crew, the origin →
 *  destination leg, the receiving team, live position and trail — and
 *  the parcels aboard. It used to be only the journey half, because the
 *  cargo lived on a separate shipment record with no key between them,
 *  which is why the board could never say what was on a vehicle. */
export interface DispatchRun {
  id: string;
  vehiclePlate: string;
  vehicleType: string;
  origin: DispatchStation | null;
  destination: DispatchStation | null;
  status: string;
  notes: string | null;
  currentLat: number | null;
  currentLng: number | null;
  currentAt: string | null;
  arrivedAt: string | null;
  receivedBy: string | null;
  createdAt: string;
  crew: DispatchCrew[];
  receivers: DispatchReceiver[];
  trail: DispatchPing[];
  /** The route followed, when one was chosen. Null for an ad-hoc run —
   *  a vehicle at the door nobody scheduled, which stays possible on
   *  purpose (ADR-0006). */
  routeId: string | null;
  routeName: string | null;
  /** Parcels currently aboard. The number the merge exists to make
   *  answerable from the board. */
  loaded: number;
}

/** One stop on a route: a station, and where it falls in the order. */
export interface OrgRouteStop {
  id: string;
  sequence: number;
  stationId: string;
  stationName: string;
  locationHint: string;
  lat: number;
  lng: number;
}

/** A company's own route — the ordered list of stations it serves. A
 *  LEG is a consecutive pair of stops; there is no leg record, because
 *  a parcel riding two vehicles is already two run items. */
export interface OrgRoute {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  stops: OrgRouteStop[];
  /** Runs still out against it — what makes deleting one a decision. */
  openRuns: number;
}
