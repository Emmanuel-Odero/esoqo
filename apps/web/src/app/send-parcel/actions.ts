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
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

/** The standard rate card's weight brackets — used only to match a
 *  typed weight to a parcel type and to show its weightLabel (e.g.
 *  "0.5kg to 2.2kg") next to each type. No price from this is ever
 *  quoted or rendered: see SendParcelForm's own comment on why every
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

export interface BookParcelInput {
  senderName: string; senderMsisdn: string;
  receiverName: string; receiverMsisdn: string;
  originLabel: string; destinationLabel: string;
  parcelType: string; weightKg?: number; fragile: boolean; notes?: string;
  originZoneId?: string; destinationZoneId?: string;
  destinationAgentId?: string;
  // originMethod/parcelOrgId — set together when the sender picks "I'm
  // dropping this off myself" over a scheduled pickup (see
  // WalkInStationView). Omitted keeps the historical SCHEDULED_PICKUP
  // default.
  originMethod?: 'SCHEDULED_PICKUP' | 'SELF_DROPOFF';
  parcelOrgId?: string;
  // payAtCounter — no price is quoted or charged online for this
  // booking; it lands straight in BOOKED and the fee is settled in
  // person, with the agent or the courier. SendParcelForm always sends
  // true — see dbx.BookParcelInput.PayAtCounter's own comment for why
  // this is no longer restricted to a walk-in drop-off.
  payAtCounter?: boolean;
}

/** Creates the booking — always PAY_AT_COUNTER from this form (see
 *  BookParcelInput.payAtCounter), so it lands straight in BOOKED rather
 *  than DRAFT_PENDING_PAYMENT; there is no price/pay step after this
 *  call. deliveryCode is returned once, here — a guest sender has no
 *  session to revisit later (unlike the mobile app's "Sent" tab), so
 *  this is their only chance to see it themselves. It also now reaches
 *  the receiver automatically by SMS once a courier picks the parcel up. */
export async function actionBookParcel(
  input: BookParcelInput,
): Promise<{ ok: true; code: string; deliveryCode: string } | { ok: false; error: string }> {
  if (!input.senderName.trim() || !input.senderMsisdn.trim()) return { ok: false, error: 'Enter your name and phone number' };
  if (!input.receiverName.trim() || !input.receiverMsisdn.trim()) return { ok: false, error: "Enter the receiver's name and phone number" };
  if (!input.originLabel.trim() || !input.destinationLabel.trim()) return { ok: false, error: 'Enter where it’s coming from and going to' };
  try {
    const json = await goFetch<{ code: string; deliveryCode: string }>('/v1/parcels', {
      method: 'POST',
      body: JSON.stringify({
        senderName: input.senderName.trim(), senderMsisdn: input.senderMsisdn.trim(),
        receiverName: input.receiverName.trim(), receiverMsisdn: input.receiverMsisdn.trim(),
        originLabel: input.originLabel.trim(), destinationLabel: input.destinationLabel.trim(),
        parcelType: input.parcelType, weightKg: input.weightKg ?? null, fragile: input.fragile,
        notes: input.notes?.trim() || null,
        originZoneId: input.originZoneId ?? null, destinationZoneId: input.destinationZoneId ?? null,
        destinationAgentId: input.destinationAgentId ?? null,
        originMethod: input.originMethod ?? null,
        parcelOrgId: input.parcelOrgId ?? null,
        payAtCounter: input.payAtCounter ?? false,
      }),
    });
    return { ok: true, code: json.code, deliveryCode: json.deliveryCode };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
}

// The structured info a handler attached to a pre-printed label in
// the field — wire type matching Go's dbx.ParcelLabelInfo.
export interface ParcelLabelInfo {
  itemDescription: string;
  destination: string | null;
  ownerName: string | null;
  ownerContact: string | null;
  ownerGender: string | null;
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

export interface ParcelStatusView {
  code: string; status: string; originLabel: string; destinationLabel: string;
  parcelType: string; priceKes: string | null; createdAt: string; deliveredAt: string | null;
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

/** Guest-safe — the same code the sender was shown is the bearer
 *  credential for checking on a parcel, same convention a pickup code
 *  follows. Used both for the post-payment poll and for the standalone
 *  "Track a parcel" lookup. */
export async function actionCheckParcelStatus(
  code: string, k?: string,
): Promise<ParcelStatusView | null> {
  try {
    // `k` is the signature printed in a scanned label's QR. Passing it
    // through is what lets core-go say whether the sticker is genuinely
    // ours; omitting it (a typed code, an SMS link) yields
    // labelVerdict: "unverified", which is not the same as a forgery.
    const qs = k ? `?k=${encodeURIComponent(k)}` : '';
    return await goFetch<ParcelStatusView>(`/v1/parcels/${encodeURIComponent(code)}/status${qs}`);
  } catch {
    return null;
  }
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
