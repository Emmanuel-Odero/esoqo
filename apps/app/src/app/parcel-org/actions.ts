"use server";

import { revalidatePath } from "next/cache";
import {
  ParcelOrgRequestError,
  ParcelOrgUnauthorised,
  parcelOrgFetch,
  type DispatchRun,
  type OrgBus,
  type OrgBusBooking,
  type OrgBusRoute,
  type OrgBusSchedule,
  type OrgBusTrip,
  type OrgLabelSearchRow,
  type OrgParcelLabel,
  type OrgParcelRow,
  type OrgRoute,
  type OrgShipment,
  type ParcelOrgStaffRow,
  type ParcelOrgStationRow,
} from "@/lib/parcel-org-session";
import { goUrl } from "@/lib/ticketing";

export type Result = { ok: true } | { ok: false; error: string };

/** Every action here forwards the portal's bearer and lets core-go
 *  decide. The org is read from the session on that side, so nothing in
 *  this file ever names a company — there is no parameter a browser
 *  could edit to act on somebody else's parcels. */
/** Always the failure variant — typed as such rather than as the wider
 *  Result so callers returning a richer success shape (see
 *  receiveWalkInParcel, which hands back the resolved code) can still
 *  funnel their errors through it.
 *
 *  `code` is core-go's own error code, forwarded verbatim so a caller
 *  can branch on which failure this was instead of reading the prose —
 *  the offline counter queue needs exactly that for LABEL_ALREADY_SPENT.
 *  Optional because a session expiry and a thrown non-Error have no
 *  server code to forward. */
function toResult(e: unknown): { ok: false; error: string; errorCode?: string } {
  if (e instanceof ParcelOrgUnauthorised) {
    return {
      ok: false,
      error: "Your shift session has expired — sign in again",
      errorCode: "UNAUTHORISED",
    };
  }
  if (e instanceof ParcelOrgRequestError) {
    return { ok: false, error: e.message, errorCode: e.code };
  }
  return {
    ok: false,
    error: e instanceof Error ? e.message : "That did not work",
  };
}

/**
 * The front desk's "I have this in hand" button for a self-drop-off
 * walk-in — calls the same custody-scan endpoint a courier's own pickup
 * scan uses (POST /v1/parcels/:code/handoff). Nothing here is
 * walk-in-specific on the server: a self-drop-off booking simply never
 * had a collector assigned, so the one FORBIDDEN gate ScanHandoff
 * checks (a different pre-assigned collector) never fires, and the
 * genuine first BOOKED->PICKED_UP transition fires the existing
 * sender/receiver SMS pair (see notify.ParcelIntakeConfirmed/
 * ParcelIntakeConfirmedToReceiver) and, for a courier company's own
 * parcel, the team dispatch summary (notify.ParcelOrgDispatchSummary).
 */
export async function receiveWalkInParcel(
  reference: string,
): Promise<
  { ok: true; code: string } | { ok: false; error: string; errorCode?: string }
> {
  try {
    // `reference` is whatever the sender walked in with. Pre-intake that
    // is the service ticket number, not the tracking code — the code
    // does not exist to the sender yet (see Parcel.serviceTicketNumber).
    // The server resolves either and hands back the REAL code, which is
    // what has to go on the printed label: a ticket number stuck to the
    // box is a reference no later scan resolves.
    const res = await parcelOrgFetch<{ status: string; code: string }>(
      `/v1/parcels/${encodeURIComponent(reference)}/handoff`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/scan");
    return { ok: true, code: res.code };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Recording the fare actually taken, in cash, for a parcel booked to be
 * paid at the counter.
 *
 * This is the other half of receiving a walk-in, and it had no home at
 * all until now: a PAY_AT_COUNTER booking lands in BOOKED with no price
 * on it (nobody has weighed the box yet), and nothing anywhere filled
 * that in afterwards — so every walk-in stayed permanently unpriced,
 * with no revenue split and nothing in any report. See
 * dbx.SettleCounterParcel.
 *
 * Deliberately a separate step from confirming receipt rather than one
 * combined button: custody and payment are different facts, and a box
 * that's physically in hand should be recorded as such even if the
 * sender is still counting out notes.
 */
export async function settleCounterParcel(
  code: string,
  priceKes: number,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcels/${encodeURIComponent(code)}/settle-counter`,
      {
        method: "POST",
        body: JSON.stringify({ priceKes }),
      },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/scan");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * The M-Pesa sibling of settleCounterParcel — pushes an STK prompt to
 * the client's own phone instead of recording cash in hand. Returns
 * immediately once the push is away; the clerk's UI then polls
 * getCounterSettlementStatus (same interval/give-up pattern
 * apps/web/pay/PayClient.tsx already uses) rather than this call
 * blocking on Safaricom's callback.
 */
export async function settleCounterParcelStk(
  code: string,
  priceKes: number,
  msisdn: string,
): Promise<{ ok: true; status: "AWAITING_MPESA" | "SETTLED" } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ status: "AWAITING_MPESA" | "SETTLED" }>(
      `/v1/parcels/${encodeURIComponent(code)}/settle-counter/stk`,
      {
        method: "POST",
        body: JSON.stringify({ priceKes, msisdn }),
      },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/counter");
    return { ok: true, status: res.status };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * The manual fallback for settleCounterParcelStk: an STK prompt went
 * out but Safaricom's own callback never confirmed it (or the clerk
 * gave up waiting), so the clerk reads the M-Pesa code off the
 * client's confirmation SMS and types it in instead. See
 * dbx.ConfirmCounterSettlementByManualCode for why this is trusted
 * rather than independently re-verified against Safaricom.
 */
export async function confirmCounterSettlementManualCode(
  code: string,
  mpesaReceiptCode: string,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcels/${encodeURIComponent(code)}/settle-counter/mpesa-code`,
      {
        method: "POST",
        body: JSON.stringify({ mpesaReceiptCode: mpesaReceiptCode.trim() }),
      },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/counter");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export type CounterSettlementStatus = {
  /** NOT_STARTED while a push was being watched means the payer
   *  declined or cancelled it and the slot was freed for another try. */
  status: "AWAITING_MPESA" | "SETTLED" | "NOT_STARTED";
  priceKes: number;
  mpesaReceiptCode: string | null;
  /** When the prompt now awaiting approval went out. */
  requestedAt: string | null;
  /** Seconds until the prompt may be cancelled (0 = now); only while awaiting. */
  cancelableInSeconds?: number;
  /** The payment provider's own word on the prompt, e.g. "PROCESSING". */
  providerStatus?: string;
};

/** Frees an M-Pesa prompt the payer never approved so the clerk can
 *  prompt again or take cash. core-go asks Co-op first (a payment that
 *  landed is recorded, not cancelled) and refuses while the prompt could
 *  still be approved. Returns where the parcel ended up. */
export async function cancelCounterSettlementStk(
  code: string,
): Promise<{ ok: true; status: CounterSettlementStatus } | { ok: false; error: string }> {
  try {
    const status = await parcelOrgFetch<CounterSettlementStatus>(
      `/v1/parcels/${encodeURIComponent(code)}/settle-counter/stk/cancel`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    return { ok: true, status };
  } catch (e) {
    return toResult(e);
  }
}

/** What the clerk's client polls while an M-Pesa counter settlement is
 *  in flight. */
export async function getCounterSettlementStatus(
  code: string,
  force = false,
): Promise<{ ok: true; status: CounterSettlementStatus } | { ok: false; error: string }> {
  try {
    const query = force ? "?force=1" : "";
    const status = await parcelOrgFetch<CounterSettlementStatus>(
      `/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/settlement-status${query}`,
    );
    return { ok: true, status };
  } catch (e) {
    return toResult(e);
  }
}

export async function assignOrgParcel(
  code: string,
  riderPartyId: string,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/assign`,
      {
        method: "POST",
        body: JSON.stringify({ riderPartyId }),
      },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ── Unsticking a receiver who can't get past the delivery code ───────
//
// A receiver proves from their own phone that they are the receiver by
// typing the code only they were sent. Three wrong tries locks the
// parcel and texts this desk. These three verbs are what the desk can
// do about it, and they escalate in that order: allow two more tries,
// then (once those are gone, or the code is simply lost) mint a
// replacement. Release is unrelated but lives here because it is the
// other half of the same flow — the courier pay a self-confirmed
// collection held instead of accruing.

/** Allow two more attempts. Refused once the parcel is hard locked —
 *  a grant that could be re-granted would not be a limit. */
export async function grantReceiverAuthRetry(code: string): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/receiver-auth/grant-retry`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Mint a new delivery code and clear every lock.
 *
 *  The new code is never returned here and never shown in this console.
 *  Both the receiver and the sender are texted it by core-go; putting
 *  it on a desk monitor would make the one secret in this flow readable
 *  by anyone walking past. */
export async function reissueDeliveryCode(code: string): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/delivery-code/reissue`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Pay out a delivery the receiver closed themselves at a pickup point.
 *  Held rather than accrued at the time because nobody from this
 *  company witnessed the handover. */
export async function releaseHeldCourierEarnings(code: string): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/parcels/${encodeURIComponent(code)}/courier-earnings/release`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** A depot manager counting one of their own riders in, without
 *  routing every hand-over through Esoqo support. The server checks the
 *  rider is on this company's books before touching anything. */
export async function remitRiderCod(
  riderPartyId: string,
  amountKes: string,
  note?: string,
): Promise<
  | { ok: true; expectedKes: string; shortfallKes: string }
  | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{
      expectedKes: string;
      shortfallKes: string;
    }>("/v1/parcel-orgs/me/cod/remit", {
      method: "POST",
      body: JSON.stringify({ riderPartyId, amountKes, note: note || null }),
    });
    revalidatePath("/parcel-org");
    return {
      ok: true,
      expectedKes: res.expectedKes,
      shortfallKes: res.shortfallKes,
    };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "That did not work" : r.error };
  }
}

/** remitRiderCod's counterpart for counter-intake cash: a manager
 *  counting a clerk's cash in instead of a rider's round. See
 *  dbx.RemitCounterCash. */
export async function remitCounterCash(
  staffId: string,
  amountKes: string,
  note?: string,
): Promise<
  | { ok: true; expectedKes: string; shortfallKes: string }
  | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{
      expectedKes: string;
      shortfallKes: string;
    }>("/v1/parcel-orgs/me/counter-cash/remit", {
      method: "POST",
      body: JSON.stringify({ staffId, amountKes, note: note || null }),
    });
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/money");
    return {
      ok: true,
      expectedKes: res.expectedKes,
      shortfallKes: res.shortfallKes,
    };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "That did not work" : r.error };
  }
}

// OrgPricingRow — mirrors dbx.ParcelPricing's JSON shape. Whatever this
// endpoint returns for a type is exactly what a sender's own quote will
// resolve to (see handleListMyOrgPricing's own comment) — this screen
// never computes a preview number of its own.
export interface OrgPricingRow {
  parcelType: string;
  weightLabel: string;
  minKes: string;
  maxKes: string;
}

export async function listOrgPricing(): Promise<OrgPricingRow[]> {
  const { pricing } = await parcelOrgFetch<{ pricing: OrgPricingRow[] | null }>(
    "/v1/parcel-orgs/me/pricing",
  );
  return pricing ?? [];
}

export async function saveOrgPricing(input: {
  parcelType: string;
  minKes: number;
  maxKes: number;
}): Promise<Result> {
  try {
    await parcelOrgFetch("/v1/parcel-orgs/me/pricing", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcel-org/settings/rates");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function listOrgStaff(): Promise<ParcelOrgStaffRow[]> {
  const { staff } = await parcelOrgFetch<{ staff: ParcelOrgStaffRow[] | null }>(
    "/v1/parcel-orgs/me/staff",
  );
  return staff ?? [];
}

export async function saveOrgStaff(input: {
  id?: string;
  name: string;
  role: string;
  pin?: string;
  msisdn?: string | null;
  partyId?: string | null;
  active: boolean;
  isContact?: boolean;
  stationId?: string | null;
  /** A custom role's picked permissions. Always sent by the form, so
   *  switching back to a preset clears them. */
  capabilities?: string[];
}): Promise<Result> {
  try {
    await parcelOrgFetch("/v1/parcel-orgs/me/staff", {
      method: "POST",
      body: JSON.stringify({
        id: input.id ?? null,
        name: input.name,
        role: input.role,
        // Empty means "leave the PIN alone" on an update — making
        // somebody retype a PIN to change a role is the kind of friction
        // that ends with a whole depot sharing one login.
        pin: input.pin ?? "",
        // A phone gives this person a full Esoqo account (person + PIN
        // credential), so they can sign in at /signin as well as the
        // company portal. Empty keeps them a company-portal-only login.
        msisdn: input.msisdn || null,
        partyId: input.partyId || null,
        active: input.active,
        // Undefined (not false) on an update leaves the flag unchanged.
        isContact: input.isContact,
        capabilities: input.capabilities,
        stationId: input.stationId || null,
      }),
    });
    revalidatePath("/parcel-org/settings/team");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function listOrgStations(): Promise<ParcelOrgStationRow[]> {
  const { stations } = await parcelOrgFetch<{
    stations: ParcelOrgStationRow[] | null;
  }>("/v1/parcel-orgs/me/stations");
  return stations ?? [];
}

export async function saveOrgStation(input: {
  id?: string;
  name: string;
  msisdn: string;
  locationHint: string;
  openingHours?: string;
  lat: number;
  lng: number;
  capacity: number;
  active: boolean;
}): Promise<Result> {
  try {
    await parcelOrgFetch(
      input.id
        ? `/v1/parcel-orgs/me/stations/${encodeURIComponent(input.id)}`
        : "/v1/parcel-orgs/me/stations",
      {
        method: input.id ? "PATCH" : "POST",
        body: JSON.stringify(input),
      },
    );
    revalidatePath("/parcel-org/settings/stations");
    revalidatePath("/parcel-org/settings/team");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ── Your own label stock ──
//
// Blank labels belong to whoever they were printed for, and core-go
// refuses a code bound to another company at booking time. That rule
// only means something once a company can actually get its own pad —
// until now the only screen that could mint or print one was Esoqo's.
//
// Nothing here names a company, for the same reason nothing else in
// this file does: the org comes from the session on the Go side, so
// there is no parameter a browser could edit to print or withdraw
// somebody else's stock.

export interface OrgLabelRow {
  code: string;
  createdAt: string;
  state: string;
  itemDescription: string | null;
  destination: string | null;
  senderName: string | null;
  infoAttachedAt: string | null;
  usedAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  batchId: string | null;
  orgName: string | null;
  /** The QR signature, so reprints from this register verify as
   *  genuine. Empty on rows the server couldn't sign. */
  sig: string;
}

export interface OrgLabelBatchRow {
  batchId: string;
  createdAt: string;
  parcelOrgId: string | null;
  orgName: string | null;
  total: number;
  live: number;
  used: number;
  voided: number;
  voidedReason: string | null;
}

export async function listOrgLabels(
  state: string,
): Promise<{ labels: OrgLabelRow[]; counts: Record<string, number> }> {
  const res = await parcelOrgFetch<{
    labels: OrgLabelRow[] | null;
    counts: Record<string, number>;
  }>(`/v1/parcel-orgs/me/labels?state=${encodeURIComponent(state)}`);
  return { labels: res.labels ?? [], counts: res.counts ?? {} };
}

export async function listOrgLabelBatches(): Promise<OrgLabelBatchRow[]> {
  const res = await parcelOrgFetch<{ batches: OrgLabelBatchRow[] | null }>(
    "/v1/parcel-orgs/me/labels/batches",
  );
  return res.batches ?? [];
}

/** Discard a handful of unused stickers — misprints, a damaged strip —
 *  without voiding the whole pad. Live-only on the server: spent codes
 *  stay on their parcels, unknown codes are ignored. */
export async function voidOrgLabels(
  codes: string[],
  reason: string,
): Promise<{ ok: true; voided: number } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ voided: number }>(
      `/v1/parcel-orgs/me/labels/void`,
      { method: "POST", body: JSON.stringify({ codes, reason }) },
    );
    revalidatePath("/parcel-org/settings/labels");
    return { ok: true, voided: res.voided };
  } catch (e) {
    const r = toResult(e);
    return {
      ok: false,
      error: r.ok ? "Could not withdraw those labels" : r.error,
    };
  }
}

/** Withdraw a whole pad — the "it was stolen from the Kisumu desk"
 *  button, without having to phone Esoqo to do it. Already-spent codes
 *  are untouched: each is on a parcel already moving. */
export async function voidOrgLabelBatch(
  batchId: string,
  reason: string,
): Promise<{ ok: true; voided: number } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ voided: number }>(
      `/v1/parcel-orgs/me/labels/batches/${encodeURIComponent(batchId)}/void`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
    revalidatePath("/parcel-org/settings/labels");
    return { ok: true, voided: res.voided };
  } catch (e) {
    const r = toResult(e);
    return {
      ok: false,
      error: r.ok ? "Could not withdraw that batch" : r.error,
    };
  }
}

export interface CustomParcelInput {
  externalRef: string;
  senderName: string;
  senderMsisdn: string;
  receiverName: string;
  receiverMsisdn: string;
  originLabel: string;
  destinationLabel: string;
  parcelType: string;
  weightKg?: number | null;
  fragile?: boolean;
  notes?: string | null;
  /** One of the company's own pre-printed labels, picked by tail
   *  search on the form. Its code becomes the parcel's tracking code. */
  labelCode?: string | null;
}

/** Save a parcel with the company's own number, so work that starts on
 *  paper or in another book can be managed and tracked on Esoqo too.
 *  Esoqo mints its own tracking code — unless a pre-printed label is
 *  attached, in which case that label's code IS the tracking code —
 *  and the company's number is kept as externalRef and searchable.
 *  Returns the Esoqo code so the caller can show it immediately. */
export async function addCustomParcel(
  input: CustomParcelInput,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ code: string }>(
      "/v1/parcel-orgs/me/parcels",
      {
        method: "POST",
        body: JSON.stringify({
          externalRef: input.externalRef.trim(),
          senderName: input.senderName.trim(),
          senderMsisdn: input.senderMsisdn.trim(),
          receiverName: input.receiverName.trim(),
          receiverMsisdn: input.receiverMsisdn.trim(),
          originLabel: input.originLabel.trim(),
          destinationLabel: input.destinationLabel.trim(),
          parcelType: input.parcelType,
          weightKg: input.weightKg ?? null,
          fragile: input.fragile ?? false,
          notes: input.notes?.trim() || null,
          labelCode: input.labelCode?.trim() || null,
        }),
      },
    );
    revalidatePath("/parcel-org");
    return { ok: true, code: res.code };
  } catch (e) {
    const r = toResult(e);
    return {
      ok: false,
      error: r.ok ? "Could not import that parcel" : r.error,
    };
  }
}

/** Change your own portal PIN — the "temp PIN in, chosen PIN out"
 *  half of the invite flow. Self-service for the whole roster: the
 *  session's own staff row is the only one core-go will touch, and the
 *  same change covers /signin phone+PIN, so one PIN keeps working at
 *  both doors. */
export async function changeMyOrgPin(
  currentPin: string,
  newPin: string,
): Promise<Result> {
  try {
    await parcelOrgFetch("/v1/parcel-orgs/me/pin", {
      method: "POST",
      body: JSON.stringify({ currentPin, newPin }),
    });
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Tail-search the company's own unused labels: type the last few
 *  characters off the physical sticker, pick the full code. */
export async function searchOrgLabels(q: string): Promise<OrgLabelSearchRow[]> {
  if (!q.trim()) return [];
  const res = await parcelOrgFetch<{ labels: OrgLabelSearchRow[] | null }>(
    `/v1/parcel-orgs/me/labels/search?q=${encodeURIComponent(q.trim())}`,
  );
  return res.labels ?? [];
}

/** Name (or clear) the team member who runs a station. */
export async function setStationManager(
  stationId: string,
  staffId: string | null,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/stations/${encodeURIComponent(stationId)}/manager`,
      {
        method: "POST",
        body: JSON.stringify({ staffId }),
      },
    );
    revalidatePath(`/parcel-org/settings/stations/${stationId}`);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Post a roster member to a station (assigned=true) or remove them. */
export async function assignStationMember(
  stationId: string,
  staffId: string,
  assigned: boolean,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/stations/${encodeURIComponent(stationId)}/members`,
      {
        method: "POST",
        body: JSON.stringify({ staffId, assigned }),
      },
    );
    revalidatePath(`/parcel-org/settings/stations/${stationId}`);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export interface AttachLabelInfoInput {
  itemDescription: string;
  destination?: string | null;
  senderName?: string | null;
  senderMsisdn?: string | null;
  receiverName?: string | null;
  receiverMsisdn?: string | null;
  itemType?: string | null;
  weightRangeKg?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

/** Look a label code up against the company's own stock — what scanning
 *  a printed label resolves to. A foreign or unknown code fails the
 *  same way, so this can't probe anyone else's labels. */
export async function resolveOrgLabel(
  code: string,
): Promise<{ ok: true; label: OrgParcelLabel } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ label: OrgParcelLabel }>(
      `/v1/parcel-orgs/me/labels/resolve?code=${encodeURIComponent(code.trim())}`,
    );
    return { ok: true, label: res.label };
  } catch (e) {
    const r = toResult(e);
    return {
      ok: false,
      error: r.ok ? "Could not look up that label" : r.error,
    };
  }
}

/** Write field notes onto one of the company's pre-printed labels —
 *  what the box is, where it's going, who it's for. Overwrites on
 *  repeat, and refuses once spent or withdrawn. */
export async function attachOrgLabelInfo(
  code: string,
  input: AttachLabelInfoInput,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/labels/info/${encodeURIComponent(code.trim())}`,
      {
        method: "POST",
        body: JSON.stringify({
          itemDescription: input.itemDescription.trim(),
          destination: input.destination?.trim() || null,
          senderName: input.senderName?.trim() || null,
          senderMsisdn: input.senderMsisdn?.trim() || null,
          receiverName: input.receiverName?.trim() || null,
          receiverMsisdn: input.receiverMsisdn?.trim() || null,
          itemType: input.itemType?.trim() || null,
          weightRangeKg: input.weightRangeKg?.trim() || null,
          lengthCm: input.lengthCm ?? null,
          widthCm: input.widthCm ?? null,
          heightCm: input.heightCm ?? null,
        }),
      },
    );
    revalidatePath("/parcel-org/settings/labels");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ── Company counter ──
//
// The same counter the Esoqo console uses (see @esoqo/ui's CounterForm
// — one screen, not two implementations), bound here to the company's
// own session: its stock, its customers, its rate card. Nothing names
// a company — the org comes from the session on the Go side, so there
// is no parameter a browser could edit to book onto another pad.

export interface OrgCounterBookInput {
  senderName: string;
  senderMsisdn: string;
  receiverName: string;
  receiverMsisdn: string;
  originLabel: string;
  destinationLabel: string;
  parcelType: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValueKes?: number;
  coverageTierId?: string;
  contentsDeclared: boolean;
  existingCode?: string;
  notes?: string;
  fragile?: boolean;
}

/** Book a parcel at the company's own counter. Lands directly in
 *  BOOKED against the company's books (pay at the desk, in person),
 *  bound to one of its own pre-printed labels when scanned — or minted
 *  fresh when the clerk starts from blank. */
export async function bookOrgCounterParcel(
  input: OrgCounterBookInput,
): Promise<
  { ok: true; code: string } | { ok: false; error: string; errorCode?: string }
> {
  try {
    const res = await parcelOrgFetch<{ code: string }>(
      "/v1/parcel-orgs/me/counter/book",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    revalidatePath("/parcel-org");
    return { ok: true, code: res.code };
  } catch (e) {
    // toResult's code rides along untouched — the offline queue reads it
    // to tell "this label was already spent, so our earlier attempt got
    // through" apart from a real rejection it must surface to the clerk.
    return toResult(e);
  }
}

export interface OrgCounterParty {
  name: string;
  msisdn: string;
  lastLabel: string;
  shipments: number;
}

/** The counter's address book: people this company has shipped to or
 *  from before, most-frequent first. Three letters minimum — two
 *  matches half the country. */
export async function searchOrgCounterParties(
  q: string,
): Promise<OrgCounterParty[]> {
  if (q.trim().length < 3) return [];
  const res = await parcelOrgFetch<{ parties: OrgCounterParty[] | null }>(
    `/v1/parcel-orgs/me/parties?q=${encodeURIComponent(q.trim())}`,
  );
  return res.parties ?? [];
}

/** The company's own parcels matching a code, exact-code first. Used by
 *  the counter's "scan a code that's already a parcel → open it" rule:
 *  a fresh-minted booking's tracking code lives only on the parcel (it
 *  was never a pre-printed stock label), so resolving a scanned code
 *  falls back here. Scoped by session exactly like every other read in
 *  this file — a foreign code simply doesn't match. */
export async function lookupOrgParcelByCode(
  code: string,
): Promise<OrgParcelRow | null> {
  const needle = code.trim().toUpperCase();
  if (!needle) return null;
  const res = await parcelOrgFetch<{ parcels: OrgParcelRow[] | null }>(
    `/v1/parcel-orgs/me/parcels?q=${encodeURIComponent(needle)}`,
  );
  return res.parcels?.find((p) => p.code.toUpperCase() === needle) ?? null;
}

export interface OrgCounterPricingOption {
  parcelType: string;
  weightLabel: string;
  minWeightKg: number;
  maxWeightKg: number;
  minKes: string;
  maxKes: string;
}

/** Every weight bracket on the company's own rate card (platform
 *  default wherever the company hasn't set its own), so the counter
 *  matches a measured weight to a bracket without a round trip per
 *  keystroke. Public endpoint — quoted before anyone signs in. */
export async function listOrgCounterPricing(
  orgId: string,
): Promise<OrgCounterPricingOption[]> {
  const res = await parcelOrgFetch<{
    pricing: OrgCounterPricingOption[] | null;
  }>(`/v1/parcels/pricing?parcelOrgId=${encodeURIComponent(orgId)}`);
  return res.pricing ?? [];
}

// ── Dispatch runs ──
//
// One vehicle on one origin → destination leg with its crew aboard and
// a receiving team at the far end. Nothing here names a company — the
// org comes from the session on the Go side, like everything else in
// this file.

export interface DispatchCrewInput {
  name: string;
  msisdn?: string | null;
  role: string;
  customRole?: string | null;
  staffId?: string | null;
}

export interface DispatchReceiverInput {
  name: string;
  staffId?: string | null;
}

export interface CreateDispatchInput {
  vehiclePlate: string;
  vehicleType: string;
  /** The planned route this run follows. Null is an ad-hoc run — a
   *  vehicle at the door nobody scheduled (ADR-0006). */
  routeId?: string | null;
  originStationId?: string | null;
  destinationStationId?: string | null;
  notes?: string | null;
  crew: DispatchCrewInput[];
  receivers: DispatchReceiverInput[];
}

/** Go's encoding/json renders a nil slice as null, so a run with no
 *  crew, no receivers or no pings yet arrives with those fields null
 *  despite the DispatchRun type saying array. Normalise at the boundary
 *  so the board never reads `.length` of null. */
function normaliseDispatchRun(r: DispatchRun): DispatchRun {
  return {
    ...r,
    crew: Array.isArray(r.crew) ? r.crew : [],
    receivers: Array.isArray(r.receivers) ? r.receivers : [],
    trail: Array.isArray(r.trail) ? r.trail : [],
  };
}

/** The board: active runs by default, recently closed ones on request. */
export async function listDispatches(
  includeClosed = false,
): Promise<DispatchRun[]> {
  // /me/runs, not /me/dispatch: one record since ADR-0006, and this one
  // carries the parcels aboard as well as the journey. The old path
  // still resolves to the same handler for installed clients.
  const res = await parcelOrgFetch<{ runs: DispatchRun[] | null }>(
    `/v1/parcel-orgs/me/runs${includeClosed ? "?closed=true" : ""}`,
  );
  return (res.runs ?? []).map(normaliseDispatchRun);
}

/** One run with its recent trail (up to 200 points): the journey line
 *  the map draws, plus the pings speed and stops derive from. */
export async function getDispatch(id: string): Promise<DispatchRun | null> {
  try {
    const res = await parcelOrgFetch<{ run: DispatchRun | null }>(
      `/v1/parcel-orgs/me/runs/${encodeURIComponent(id)}`,
    );
    return res.run ? normaliseDispatchRun(res.run) : null;
  } catch {
    return null;
  }
}

/** Open a run: vehicle, leg, crew and receiving team in one call. */
export async function createDispatch(
  input: CreateDispatchInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ id: string }>(
      "/v1/parcel-orgs/me/runs",
      {
        method: "POST",
        body: JSON.stringify({
          vehiclePlate: input.vehiclePlate.trim(),
          vehicleType: input.vehicleType,
          routeId: input.routeId || null,
          originStationId: input.originStationId || null,
          destinationStationId: input.destinationStationId || null,
          notes: input.notes?.trim() || null,
          crew: input.crew.map((c) => ({
            name: c.name.trim(),
            msisdn: c.msisdn?.trim() || null,
            role: c.role,
            customRole: c.customRole?.trim() || null,
            staffId: c.staffId || null,
          })),
          receivers: input.receivers.map((r) => ({
            name: r.name.trim(),
            staffId: r.staffId || null,
          })),
        }),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true, id: res.id };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "Could not open that run" : r.error };
  }
}

/** Move the board marker: whoever holds the run's phone posts it. */
export async function reportDispatchPosition(
  id: string,
  lat: number,
  lng: number,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/runs/${encodeURIComponent(id)}/position`,
      {
        method: "POST",
        body: JSON.stringify({ lat, lng }),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** The receiving team's check-in: the run is over, who signed is on
 *  the record. Blank falls back to the named receiving team. */
export async function arriveDispatch(
  id: string,
  receivedBy: string,
): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/runs/${encodeURIComponent(id)}/arrive`,
      {
        method: "POST",
        body: JSON.stringify({ receivedBy: receivedBy.trim() }),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** The shed moment: a loading run sets off, and loading closes
 *  behind it. Only LOADING runs can depart — the server refuses anything
 *  else, so a double-tap on a run that just left reports itself plainly. */
export async function departDispatch(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/runs/${encodeURIComponent(id)}/start`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Call a run off before it arrives. */
export async function cancelDispatch(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/runs/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// Shipment operations (createShipment / joinShipment / loadParcelToShipment
// / startShipment / finishShipment / cancelShipment / listActiveShipments /
// getLeftBehindParcels) lived here until the Counter page's "New Shipment"
// tab was removed. That tab created vehicle runs — plate, route, driver,
// conductor — which is Dispatch's job and was a third implementation of it,
// against /v1/parcel-orgs/me/shipments/*. Dispatch's own run actions
// (listDispatches and friends, above) are the ones in use.

// ── Run manifests ──
//
// The paper a crew carries and a receiving clerk checks boxes off
// against. Read from the shipment side because that is where the
// parcel↔vehicle link actually lives (parcel_shipment_item) — see the
// note in dispatch/page.tsx about the two run models.

/** One line on a manifest. Mirrors dbx.ManifestItem. */
export interface ManifestItem {
  code: string;
  externalRef: string;
  receiverName: string;
  receiverMsisdn: string;
  destinationLabel: string;
  parcelType: string;
  status: string;
  loadedAt: string;
}

/** A run and everything loaded onto it, in load order. */
export async function getRunManifest(
  shipmentId: string,
): Promise<
  { ok: true; shipment: OrgShipment; items: ManifestItem[] } | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{ shipment: OrgShipment; items: ManifestItem[] | null }>(
      `/v1/parcel-orgs/me/shipments/${encodeURIComponent(shipmentId)}/manifest`,
    );
    return { ok: true, shipment: res.shipment, items: res.items ?? [] };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "Could not load that manifest" : r.error };
  }
}

/**
 * Every row matching a filter, for export — not just the page on screen.
 *
 * The register's CSV button used to write out whatever 25 rows were
 * rendered, under a filename that said nothing about that, so "export
 * the overdue parcels" quietly produced the first page of them. This
 * asks the server for the whole set.
 *
 * Capped, and the caller is told when the cap bit: a silent truncation
 * in an export is worse than no export, because a short file looks
 * exactly like a complete one.
 */
export async function exportOrgParcels(
  query: string,
): Promise<
  { ok: true; parcels: OrgParcelRow[]; truncated: boolean } | { ok: false; error: string }
> {
  const MAX = 5000;
  try {
    const qs = new URLSearchParams(query);
    qs.delete("page");
    qs.set("perPage", String(MAX));
    const res = await parcelOrgFetch<{ parcels: OrgParcelRow[] | null; total?: number }>(
      `/v1/parcel-orgs/me/parcels?${qs.toString()}`,
    );
    const parcels = res.parcels ?? [];
    return { ok: true, parcels, truncated: (res.total ?? parcels.length) > parcels.length };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "Could not build that export" : r.error };
  }
}

// ── Routes ──
//
// A company's own map: which stations, in what order. Defining one is
// configuration a manager does monthly (hence Settings), while running
// one is Dispatch, daily — the same split Stations already follows.

export async function listOrgRoutes(): Promise<OrgRoute[]> {
  const res = await parcelOrgFetch<{ routes: OrgRoute[] | null }>(
    "/v1/parcel-orgs/me/routes",
  );
  return (res.routes ?? []).map((r) => ({
    ...r,
    stops: Array.isArray(r.stops) ? r.stops : [],
  }));
}

/** One stop as saved: either an existing station, or a free-text
 *  place with no station there yet (a bus route passing through a
 *  town with no shop). Exactly one of the two is set. */
export interface OrgRouteStopInput {
  stationId?: string | null;
  placeName?: string | null;
}

/** Create (no id) or replace (with one). The stop order IS the
 *  route, so reordering on the client is just another save. */
export async function saveOrgRoute(input: {
  id?: string;
  name: string;
  code?: string | null;
  stops: OrgRouteStopInput[];
  distanceKm?: number | null;
  active: boolean;
}): Promise<Result> {
  try {
    await parcelOrgFetch(
      input.id
        ? `/v1/parcel-orgs/me/routes/${encodeURIComponent(input.id)}`
        : "/v1/parcel-orgs/me/routes",
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          code: input.code || null,
          stops: input.stops,
          distanceKm: input.distanceKm ?? null,
          active: input.active,
        }),
      },
    );
    revalidatePath("/parcel-org/settings/routes");
    revalidatePath("/parcel-org/settings/transport");
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteOrgRoute(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/routes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    revalidatePath("/parcel-org/settings/routes");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ── Transport (ParcelOrg.offersTransport) ──
//
// A courier company that also runs passenger buses: fleet, routes,
// schedules (prices/capacities) and trips, configured here; seats sold
// at the counter from /parcel-org/counter/bus.

const TRANSPORT_SETTINGS_PATH = "/parcel-org/settings/transport";

export async function listOrgBuses(): Promise<OrgBus[]> {
  const res = await parcelOrgFetch<{ buses: OrgBus[] | null }>(
    "/v1/parcel-orgs/me/transport/buses",
  );
  return res.buses ?? [];
}

export async function saveOrgBus(input: {
  id?: string;
  name: string;
  plateNumber: string;
  totalSeats: number;
  seatLayout?: string | null;
  amenities?: string[];
  status?: "ACTIVE" | "INACTIVE";
}): Promise<Result> {
  try {
    await parcelOrgFetch(
      input.id
        ? `/v1/parcel-orgs/me/transport/buses/${encodeURIComponent(input.id)}`
        : "/v1/parcel-orgs/me/transport/buses",
      { method: "POST", body: JSON.stringify(input) },
    );
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteOrgBus(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/transport/buses/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** A transport company's routes ride the SAME ParcelRoute list its
 *  parcel runs use — managed at Settings → Routes (saveOrgRoute/
 *  deleteOrgRoute above), not here. This is a read-only,
 *  origin/destination-shaped projection of that list for the
 *  schedule/trip pickers below. */
export async function listOrgBusRoutes(): Promise<OrgBusRoute[]> {
  const res = await parcelOrgFetch<{ routes: OrgBusRoute[] | null }>(
    "/v1/parcel-orgs/me/transport/routes",
  );
  return res.routes ?? [];
}

export async function listOrgBusSchedules(): Promise<OrgBusSchedule[]> {
  const res = await parcelOrgFetch<{ schedules: OrgBusSchedule[] | null }>(
    "/v1/parcel-orgs/me/transport/schedules",
  );
  return res.schedules ?? [];
}

export async function saveOrgBusSchedule(input: {
  id?: string;
  busId: string;
  routeId: string;
  departTime: string;
  daysOfWeek: number[];
  priceKes: number;
  active: boolean;
}): Promise<Result> {
  try {
    await parcelOrgFetch(
      input.id
        ? `/v1/parcel-orgs/me/transport/schedules/${encodeURIComponent(input.id)}`
        : "/v1/parcel-orgs/me/transport/schedules",
      { method: "POST", body: JSON.stringify(input) },
    );
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteOrgBusSchedule(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/transport/schedules/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function listOrgBusTrips(routeId?: string): Promise<OrgBusTrip[]> {
  const qs = routeId ? `?routeId=${encodeURIComponent(routeId)}` : "";
  const res = await parcelOrgFetch<{ trips: OrgBusTrip[] | null }>(
    `/v1/parcel-orgs/me/transport/trips${qs}`,
  );
  return res.trips ?? [];
}

export async function createOrgBusTrip(input: {
  busId: string;
  routeId: string;
  departAt: string; // RFC3339
  priceKes: number;
}): Promise<Result> {
  try {
    await parcelOrgFetch("/v1/parcel-orgs/me/transport/trips", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function cancelOrgBusTrip(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/transport/trips/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
    revalidatePath(TRANSPORT_SETTINGS_PATH);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function listOrgBusTripBookings(tripId: string): Promise<OrgBusBooking[]> {
  const res = await parcelOrgFetch<{ bookings: OrgBusBooking[] | null }>(
    `/v1/parcel-orgs/me/transport/trips/${encodeURIComponent(tripId)}/bookings`,
  );
  return res.bookings ?? [];
}

/** The counter's "sell a seat" action — always cash, settled on the
 *  spot, same shape bookOrgCounterParcel follows for a parcel sale. */
export async function bookCounterBusSeat(input: {
  tripId: string;
  seatNumber: number;
  passengerName: string;
  passengerMsisdn: string;
  passengerIdNumber?: string | null;
}): Promise<
  | { ok: true; bookingId: string; code: string; totalKes: string }
  | { ok: false; error: string }
> {
  try {
    const res = await parcelOrgFetch<{ bookingId: string; code: string; totalKes: string }>(
      "/v1/parcel-orgs/me/transport/counter/book",
      { method: "POST", body: JSON.stringify(input) },
    );
    revalidatePath("/parcel-org/counter/bus");
    return { ok: true, ...res };
  } catch (e) {
    return toResult(e);
  }
}

export async function cancelCounterBusBooking(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/transport/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
    revalidatePath("/parcel-org/counter/bus");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Seat availability is the same public read the web booking flow uses
 *  (nothing sensitive in "which seat numbers are taken") — no org
 *  session needed, so the counter calls it directly rather than
 *  through parcelOrgFetch. */
export async function getBusTripSeats(
  tripId: string,
): Promise<{ seatsTotal: number; takenSeats: number[] }> {
  try {
    const res = await fetch(goUrl(`/v1/transport/trips/${encodeURIComponent(tripId)}/seats`), {
      cache: "no-store",
    });
    if (!res.ok) return { seatsTotal: 0, takenSeats: [] };
    const json = (await res.json()) as { seatsTotal?: number; takenSeats?: number[] };
    return { seatsTotal: json.seatsTotal ?? 0, takenSeats: json.takenSeats ?? [] };
  } catch {
    return { seatsTotal: 0, takenSeats: [] };
  }
}
