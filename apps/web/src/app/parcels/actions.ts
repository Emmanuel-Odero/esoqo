'use server';

// Same convention as apps/web/tickets/[slug]/actions.ts: server-side Go
// calls use the docker/compose service URL, falling back to localhost
// for bare-metal dev. No auth header anywhere in this file — sending a
// parcel from this page is deliberately guest-only, same boundary as
// tickets checkout and apps/store's storefront (see ADR-0003). The
// sender/receiver details on the form ARE the identity core-go needs;
// nothing here ever reads or requires a session cookie.
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

const UNAVAILABLE = 'The parcel service is unreachable. Check your connection and try again.';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

function goMessage(json: GoErrorBody | null, fallback: string): string {
  return typeof json?.error?.message === 'string' && json.error.message ? json.error.message : fallback;
}

async function goFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CORE_GO_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // fetch() itself throwing (DNS/connection failure, timeout) means
    // core-go was never reached — its raw error message is Node/undici
    // internals ("fetch failed"), not something a sender should see.
    // Every caller's catch block does `e instanceof Error ? e.message :
    // UNAVAILABLE`, which would otherwise surface that raw string
    // verbatim instead of the friendly one it exists for.
    throw new Error(UNAVAILABLE);
  }
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

/** The standard rate card's weight brackets — used only to match a
 *  typed weight to a parcel type and to show its weightLabel (e.g.
 *  "0.5kg to 2.2kg") next to each type. No price from this is ever
 *  quoted or rendered: see AtOfficeSendForm's own comment on why every
 *  booking here is PAY_AT_COUNTER, settled in person. */
export interface ParcelPricingView {
  parcelType: string; weightLabel: string; minWeightKg: number; maxWeightKg: number;
}
export interface ParcelZoneView { id: string; name: string; lat: number; lng: number; active: boolean }

/** A neighbourhood pickup point — a real shop the receiver walks to.
 *  The cheap leg: see Go's parcel_agents.go for why agent-to-agent is
 *  what makes the price competitive here. */
export interface ParcelAgentView {
  id: string; name: string; zoneId: string | null; zoneName: string | null;
  lat: number; lng: number; msisdn: string; locationHint: string;
  openingHours: string | null; active: boolean;
  capacity: number; holdingFeeKes: string; parcelsHeld: number;
  distanceKm?: number;
}

export async function actionListParcelAgents(): Promise<ParcelAgentView[]> {
  try {
    const { agents } = await goFetch<{ agents: ParcelAgentView[] | null }>('/v1/parcels/agents');
    return agents ?? [];
  } catch {
    return [];
  }
}

/** A partner company's own front desk — the origin-side counterpart of
 *  ParcelAgentView. Lets a sender who's physically at a station pick it
 *  instead of scheduling a pickup. See GET /v1/parcels/stations. */
export interface WalkInStationView {
  id: string; name: string; locationHint: string;
  openingHours: string | null; lat: number | null; lng: number | null;
}

export async function actionListWalkInStations(): Promise<WalkInStationView[]> {
  try {
    const { stations } = await goFetch<{ stations: WalkInStationView[] | null }>('/v1/parcels/stations');
    return stations ?? [];
  } catch {
    return [];
  }
}

/** One of a named courier company's own branches — the destination
 *  search once a sender has already picked which office they're
 *  standing in. See GET /v1/parcels/org-stations. */
export interface PublicOrgStationView {
  id: string; name: string; locationHint: string;
  openingHours: string | null; lat: number | null; lng: number | null;
}

export async function actionListOrgStations(orgId: string): Promise<PublicOrgStationView[]> {
  if (!orgId) return [];
  try {
    const { stations } = await goFetch<{ stations: PublicOrgStationView[] | null }>(
      `/v1/parcels/org-stations?orgId=${encodeURIComponent(orgId)}`,
    );
    return stations ?? [];
  } catch {
    return [];
  }
}

/** Every parcel type's price band at once — same one-call shape the
 *  mobile booking form uses to match a typed weight to a bracket
 *  client-side, without a round trip per keystroke. */
export async function actionListParcelPricing(): Promise<ParcelPricingView[]> {
  try {
    const { pricing } = await goFetch<{ pricing: ParcelPricingView[] | null }>('/v1/parcels/pricing');
    return pricing ?? [];
  } catch {
    return [];
  }
}

export async function actionListParcelZones(): Promise<ParcelZoneView[]> {
  try {
    const { zones } = await goFetch<{ zones: ParcelZoneView[] | null }>('/v1/parcels/zones');
    return zones ?? [];
  } catch {
    return [];
  }
}

// The structured info a handler attached to a pre-printed label in
// the field — wire type matching Go's dbx.ParcelLabelInfo.
export interface ParcelLabelInfo {
  itemDescription: string;
  destination: string | null;
  senderName: string | null;
  senderMsisdn: string | null;
  receiverName: string | null;
  receiverMsisdn: string | null;
  itemType: string | null;
  weightRangeKg: string | null;
  attachedAt: string;
}

/** Where to collect a parcel that's waiting on a pickup point's shelf.
 *  Cut down from the full agent record — no capacity, no shelf count,
 *  no owning party: operational numbers that are nobody's business at
 *  the counter. */
export interface ParcelAgentStopView {
  name: string; msisdn: string; locationHint: string;
  openingHours: string | null; lat: number; lng: number; holdingFeeKes: string;
}

/** The reduced stub `GET /v1/parcels/:code/status` returns before any
 *  handler has confirmed physical custody — looked up by a service
 *  ticket number, or in principle a not-yet-revealed real code (see
 *  core-go's Parcel.serviceTicketNumber schema comment). There is
 *  genuinely nothing else to show yet, not a loading state, so this
 *  stays its own small type rather than an all-optional
 *  ParcelStatusView — the real one keeps every field it always had. */
export interface AwaitingIntakeView {
  status: 'AWAITING_INTAKE';
  message: string;
}

export interface ParcelStatusView {
  code: string; status: string; originLabel: string; destinationLabel: string;
  parcelType: string; priceKes: string | null; createdAt: string; deliveredAt: string | null;
  /** When the box was first physically received — a counter receipt or
   *  the first pickup. Dates the "received" stage on the tracker. */
  intakeConfirmedAt?: string | null;
  /** The full custody timeline, oldest first, guest-safe (time + stage
   *  label only, never a holder's name). Lets the tracker show
   *  "received at counter 2:14pm → delivered 5:40pm" rather than a bare
   *  current status. See dbx.ListParcelTrackEvents. */
  events?: ParcelTrackEventView[];
  /** The delivery promise frozen at payment time — what lets the page
   *  say "arriving by 4pm today" instead of showing a stepper with no
   *  sense of time at all. */
  slaDeadlineAt?: string | null;
  /** Failed-attempt summary. lastAttemptText is the server's own
   *  sentence for the reason code, so web, mobile and SMS all explain a
   *  failure identically. */
  deliveryAttempts?: number;
  lastAttemptAt?: string | null;
  lastAttemptReason?: string | null;
  lastAttemptText?: string | null;
  /** Proof of delivery. podPhotoUrl is a storage key, never a public
   *  URL — the image is fetched through the API's own authorised route
   *  (see parcelPodPhotoUrl below). */
  podPhotoUrl?: string | null;
  podReceivedByName?: string | null;
  podMethod?: string | null;
  agent?: ParcelAgentStopView | null;
  /** Operational text, not PII — safe on this guest-safe projection,
   *  and without them a CANCELLED parcel has nothing to show beyond the
   *  bare enum. */
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  receiptConfirmedAt?: string | null;
  // preLabel/preLabelInfo — set when `code` is a pre-printed label
  // (see dbx.ParcelLabelStock) scanned/tracked before it was ever
  // attached to a real booking. status reads "LABEL_PRINTED" in that
  // case; preLabelInfo is null until at least an item description has
  // been attached to it (see the admin "Attach info to a label"
  // screen), even for a genuinely pre-printed (but still blank) label.
  preLabel?: boolean;
  preLabelInfo?: ParcelLabelInfo | null;
  // labelVerdict — whether the physical label this was scanned from is
  // genuinely ours. "genuine" | "unverified" | "forged"; absent on any
  // path that didn't come from a scan. "unverified" is not a failure —
  // a typed code, or a label printed before signing existed, has no
  // signature to check. See the /p/[code] page.
  labelVerdict?: string;
  /** The courier company this parcel or label belongs to, if any —
   *  what lets a scan answer "whose label is this" with a company name
   *  and "managed by Esoqo". Null for shared-pool stock. */
  orgName?: string | null;
  /** That same company's logo, alongside its name. Null whenever
   *  orgName is null (shared Esoqo pool, no company to brand). */
  orgLogoUrl?: string | null;
}

/** One line of the public custody timeline. `label` is the server's own
 *  human sentence so web, mobile and any future surface don't each map
 *  the raw status themselves. */
export interface ParcelTrackEventView {
  at: string;
  status: string;
  label: string;
  /** INFO | WARNING | CRITICAL. Every custody leg is INFO — a leg
   *  exists because something went right. It matters for the
   *  non-custody rows merged in beside them (a receiver locking
   *  themselves out, a code being reissued), which the timeline drew as
   *  green ticks until this existed. Optional so a response from an
   *  older core-go still renders. */
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

/** Where the parcel is right now. Deliberately anonymous — no courier
 *  name or id: "your parcel is here" is what a code holder is entitled
 *  to, a live feed of a named person's location is not. */
export interface CourierPositionView {
  lat: number; lng: number; at: string; staleMins: number;
}

/** Returns null whenever there's nothing to show — a parcel that isn't
 *  moving, or a courier whose phone hasn't pinged recently. The server
 *  answers 200 with a null position for those (see
 *  handleGetParcelCourierPosition) precisely so the common case isn't
 *  an error a polling client has to special-case. */
/** Set when the parcel is riding a passenger bus rather than a
 *  courier. The vehicle is already reporting its position for the
 *  passengers sitting in it, so a parcel on board is tracked by the bus
 *  — fresher and far more reliable than a ping loop on a handset, and
 *  free. */
export interface ParcelTripView {
  routeName: string;
  vehiclePlate: string;
  orgName: string;
  dropStageName: string | null;
}

export interface ParcelPositionResult {
  position: CourierPositionView | null;
  trip: ParcelTripView | null;
}

export async function actionGetCourierPosition(code: string): Promise<ParcelPositionResult> {
  try {
    const res = await goFetch<ParcelPositionResult>(
      `/v1/parcels/${encodeURIComponent(code)}/position`,
    );
    return { position: res.position ?? null, trip: res.trip ?? null };
  } catch {
    return { position: null, trip: null };
  }
}

/** One lookup's outcome, discriminated so the caller can tell a parcel
 *  that genuinely doesn't exist from a service that failed to answer —
 *  the two are not the same and must never be rendered as the same. */
export type ParcelStatusResult =
  | { kind: 'found'; parcel: ParcelStatusView | AwaitingIntakeView }
  | { kind: 'not-found' }
  | { kind: 'error'; error: string };

/** Guest-safe — the same code the sender was shown is the bearer
 *  credential for checking on a parcel, same convention a pickup code
 *  follows. Used both for the post-payment poll and for the standalone
 *  "Track a parcel" lookup.
 *
 *  Returns { kind: 'not-found' } only when core-go itself answered 404 —
 *  a code that really isn't on record. Anything else that goes wrong
 *  (service unreachable, core-go erroring) comes back as
 *  { kind: 'error' } with a human message, NOT as a not-found, so a down
 *  backend can't masquerade as "bad code" on someone's screen. */
export async function actionCheckParcelStatus(
  code: string, k?: string,
): Promise<ParcelStatusResult> {
  // `k` is the signature printed in a scanned label's QR. Passing it
  // through is what lets core-go say whether the sticker is genuinely
  // ours; omitting it (a typed code, an SMS link) yields
  // labelVerdict: "unverified", which is not the same as a forgery.
  const url = `/v1/parcels/${encodeURIComponent(code)}/status${k ? `?k=${encodeURIComponent(k)}` : ''}`;
  let res: Response;
  try {
    res = await fetch(`${CORE_GO_URL}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // fetch() throwing (DNS/connection failure, timeout) means core-go
    // was never reached — the message is Node/undici internals
    // ("fetch failed"), so swap in the friendly one instead.
    return { kind: 'error', error: UNAVAILABLE };
  }
  const json = (await res.json().catch(() => null)) as ParcelStatusView | AwaitingIntakeView | null;
  if (!res.ok) {
    if (res.status === 404) return { kind: 'not-found' };
    return { kind: 'error', error: goMessage(json as GoErrorBody | null, UNAVAILABLE) };
  }
  if (!json) return { kind: 'error', error: UNAVAILABLE };
  return { kind: 'found', parcel: json };
}

export interface ParcelReceiptView {
  code: string;
  status: string;
  orgName: string | null;
  orgLogoUrl: string | null;
  originLabel: string;
  destinationLabel: string;
  senderName: string;
  receiverName: string;
  parcelType: string;
  priceKes: string | null;
  paymentMethod: string | null;
  mpesaReceiptCode: string | null;
  paidAt: string | null;
  createdAt: string;
}

export type ParcelReceiptResult =
  | { kind: 'found'; receipt: ParcelReceiptView }
  | { kind: 'not-found' }
  | { kind: 'error'; error: string };

/** Guest-safe on the same bearer-credential convention
 *  actionCheckParcelStatus follows — see dbx.GetParcelReceipt's own
 *  comment on why an unpaid parcel comes back not-found rather than a
 *  reduced view. */
export async function actionGetParcelReceipt(code: string): Promise<ParcelReceiptResult> {
  let res: Response;
  try {
    res = await fetch(`${CORE_GO_URL}/v1/parcels/${encodeURIComponent(code)}/receipt`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { kind: 'error', error: UNAVAILABLE };
  }
  const json = (await res.json().catch(() => null)) as ParcelReceiptView | null;
  if (!res.ok) {
    if (res.status === 404) return { kind: 'not-found' };
    return { kind: 'error', error: goMessage(json as GoErrorBody | null, UNAVAILABLE) };
  }
  if (!json) return { kind: 'error', error: UNAVAILABLE };
  return { kind: 'found', receipt: json };
}

// ── Claiming a parcel ──
//
// The tracking view above is deliberately PII-free: the code is printed
// on the outside of a box and passes through many hands, so it can
// never be enough on its own to unlock a name and an address. These two
// are the way past that — and the way past is proving you hold the
// phone, not that you hold the code.

/** What a verified sender or receiver sees: the public view plus their
 *  own side of the transaction. Mirrors Go's dbx.ParcelPartyView. */
export interface ParcelPartyView extends ParcelStatusView {
  tier: 'SENDER' | 'RECEIVER';
  counterpartyName: string;
  counterpartyPhoneLast4: string;
  priceKesOwn?: string | null;
  paymentMethod?: string | null;
  refundStatus?: string | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  codDueKes?: string | null;
  deliveryCode?: string | null;
}

/**
 * Ask for a verification code.
 *
 * Succeeds identically whether or not the number is on the parcel —
 * core-go will not say, and neither will this. A response that differed
 * would let anyone holding a code they found test which numbers are
 * connected to it, which is the exact linkage this whole flow exists to
 * prevent. Someone who typed the wrong number simply never gets a text.
 */
export async function actionRequestParcelClaimOtp(
  code: string, msisdn: string,
): Promise<{ ok: true; hint: string } | { ok: false; error: string }> {
  try {
    const json = await goFetch<{ hint: string }>(
      `/v1/parcels/${encodeURIComponent(code)}/claim/otp`,
      { method: 'POST', body: JSON.stringify({ msisdn: msisdn.trim() }) },
    );
    return { ok: true, hint: json.hint };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send a code right now' };
  }
}

/** Spend the code. Returns the tier-appropriate view directly — there
 *  is no token to keep, on purpose: nothing long-lived pointing at
 *  somebody's address is left sitting in a browser. */
export async function actionVerifyParcelClaim(
  code: string, msisdn: string, otp: string,
): Promise<{ ok: true; parcel: ParcelPartyView } | { ok: false; error: string }> {
  try {
    const parcel = await goFetch<ParcelPartyView>(
      `/v1/parcels/${encodeURIComponent(code)}/claim/verify`,
      { method: 'POST', body: JSON.stringify({ msisdn: msisdn.trim(), code: otp.trim() }) },
    );
    return { ok: true, parcel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'That code did not match' };
  }
}

// ── The other way in: possession of the delivery code ────────────────
//
// The mirror of the claim pair above. That one proves "I'm a party to
// this parcel" by the PHONE and then hands the receiver their delivery
// code; this proves the same thing by the CODE. Both exist because the
// assumption each rests on is the one that fails in the other's case: a
// receiver whose SMS never arrived has no phone route, and a receiver
// whose sender read the code down the line has no need of one.

/** What a receiver-tier verification returns. `canSelfConfirm` is the
 *  server's answer, not a guess from the status — it mirrors the same
 *  two guards dbx.DeliverParcel enforces, and `selfConfirmReason` is
 *  what to tell somebody when the answer is no. */
export interface ReceiverAuthSuccess {
  ok: true;
  parcel: ParcelPartyView;
  receiverToken: string;
  canSelfConfirm: boolean;
  selfConfirmReason: string;
}

/** Failure carries core-go's error CODE, not just its message: the
 *  panel renders three genuinely different states (keep trying, locked,
 *  hard locked) and string-matching a sentence to tell them apart is
 *  how a copy edit becomes a bug. */
export interface ReceiverAuthFailure {
  ok: false;
  code: 'WRONG_CODE' | 'RECEIVER_LOCKED' | 'RECEIVER_HARD_LOCKED' | 'OTHER';
  error: string;
}

/** goFetch collapses every failure to a message. This keeps the code,
 *  which is the whole point here. */
async function goFetchCoded<T>(
  path: string, init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${CORE_GO_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, code: 'OTHER', message: UNAVAILABLE };
  }
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) {
    return {
      ok: false,
      code: json?.error?.code ?? 'OTHER',
      message: goMessage(json ?? null, UNAVAILABLE),
    };
  }
  return { ok: true, data: json as T };
}

/**
 * Prove you are the receiver by typing the private delivery code.
 *
 * Three attempts, counted on the parcel itself rather than per browser
 * — see dbx.VerifyReceiverCode. A fourth is refused for everyone until
 * the carrying company grants more or issues a new code.
 */
export async function actionVerifyReceiverCode(
  code: string, deliveryCode: string,
): Promise<ReceiverAuthSuccess | ReceiverAuthFailure> {
  const res = await goFetchCoded<{
    parcel: ParcelPartyView;
    receiverToken: string;
    canSelfConfirm: boolean;
    selfConfirmReason: string;
  }>(
    `/v1/parcels/${encodeURIComponent(code)}/receiver/verify`,
    { method: 'POST', body: JSON.stringify({ deliveryCode: deliveryCode.trim() }) },
  );
  if (!res.ok) {
    const known = ['WRONG_CODE', 'RECEIVER_LOCKED', 'RECEIVER_HARD_LOCKED'] as const;
    const match = known.find((k) => k === res.code);
    return { ok: false, code: match ?? 'OTHER', error: res.message };
  }
  return { ok: true, ...res.data };
}

/**
 * Close the parcel yourself, at the pickup point.
 *
 * Spends the single-use token minted by the verify above. Every guard
 * that matters (waiting at an agent, no cash outstanding) is re-checked
 * by core-go — this can only ever fail safe.
 */
export async function actionReceiverSelfConfirm(
  code: string, receiverToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await goFetchCoded<{ delivered: boolean }>(
    `/v1/parcels/${encodeURIComponent(code)}/receiver/confirm`,
    { method: 'POST', body: JSON.stringify({ receiverToken }) },
  );
  if (!res.ok) return { ok: false, error: res.message };
  return { ok: true };
}
