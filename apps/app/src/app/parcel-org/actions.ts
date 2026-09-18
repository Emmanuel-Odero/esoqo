"use server";

import { revalidatePath } from "next/cache";
import {
  ParcelOrgUnauthorised,
  parcelOrgFetch,
  type DispatchRun,
  type OrgLabelSearchRow,
  type OrgParcelLabel,
  type ParcelOrgStaffRow,
  type ParcelOrgStationRow,
} from "@/lib/parcel-org-session";

export type Result = { ok: true } | { ok: false; error: string };

/** Every action here forwards the portal's bearer and lets core-go
 *  decide. The org is read from the session on that side, so nothing in
 *  this file ever names a company — there is no parameter a browser
 *  could edit to act on somebody else's parcels. */
/** Always the failure variant — typed as such rather than as the wider
 *  Result so callers returning a richer success shape (see
 *  receiveWalkInParcel, which hands back the resolved code) can still
 *  funnel their errors through it. */
function toResult(e: unknown): { ok: false; error: string } {
  if (e instanceof ParcelOrgUnauthorised) {
    return {
      ok: false,
      error: "Your shift session has expired — sign in again",
    };
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
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
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
    revalidatePath("/parcel-org/receive");
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
    revalidatePath("/parcel-org/receive");
    return { ok: true };
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
    revalidatePath("/parcel-org/pricing");
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
    revalidatePath("/parcel-org/team");
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
    revalidatePath("/parcel-org/stations");
    revalidatePath("/parcel-org/team");
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
    revalidatePath("/parcel-org/labels");
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
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    revalidatePath("/parcel-org/labels");
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
    const res = await parcelOrgFetch<{ code: string }>("/v1/parcel-orgs/me/parcels", {
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
    });
    revalidatePath("/parcel-org");
    return { ok: true, code: res.code };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "Could not import that parcel" : r.error };
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
    await parcelOrgFetch(`/v1/parcel-orgs/me/stations/${encodeURIComponent(stationId)}/manager`, {
      method: "POST",
      body: JSON.stringify({ staffId }),
    });
    revalidatePath(`/parcel-org/stations/${stationId}`);
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
    await parcelOrgFetch(`/v1/parcel-orgs/me/stations/${encodeURIComponent(stationId)}/members`, {
      method: "POST",
      body: JSON.stringify({ staffId, assigned }),
    });
    revalidatePath(`/parcel-org/stations/${stationId}`);
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
    return { ok: false, error: r.ok ? "Could not look up that label" : r.error };
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
    await parcelOrgFetch(`/v1/parcel-orgs/me/labels/info/${encodeURIComponent(code.trim())}`, {
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
    });
    revalidatePath("/parcel-org/labels");
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
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ code: string }>("/v1/parcel-orgs/me/counter/book", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcel-org");
    return { ok: true, code: res.code };
  } catch (e) {
    const r = toResult(e);
    return { ok: false, error: r.ok ? "Could not book that parcel" : r.error };
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
export async function searchOrgCounterParties(q: string): Promise<OrgCounterParty[]> {
  if (q.trim().length < 3) return [];
  const res = await parcelOrgFetch<{ parties: OrgCounterParty[] | null }>(
    `/v1/parcel-orgs/me/parties?q=${encodeURIComponent(q.trim())}`,
  );
  return res.parties ?? [];
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
export async function listOrgCounterPricing(orgId: string): Promise<OrgCounterPricingOption[]> {
  const res = await parcelOrgFetch<{ pricing: OrgCounterPricingOption[] | null }>(
    `/v1/parcels/pricing?parcelOrgId=${encodeURIComponent(orgId)}`,
  );
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
  originStationId?: string | null;
  destinationStationId?: string | null;
  notes?: string | null;
  crew: DispatchCrewInput[];
  receivers: DispatchReceiverInput[];
}

/** The board: active runs by default, recently closed ones on request. */
export async function listDispatches(includeClosed = false): Promise<DispatchRun[]> {
  const res = await parcelOrgFetch<{ dispatches: DispatchRun[] | null }>(
    `/v1/parcel-orgs/me/dispatch${includeClosed ? "?closed=true" : ""}`,
  );
  return res.dispatches ?? [];
}

/** One run with its recent trail (up to 200 points): the journey line
 *  the map draws, plus the pings speed and stops derive from. */
export async function getDispatch(id: string): Promise<DispatchRun | null> {
  try {
    const res = await parcelOrgFetch<{ dispatch: DispatchRun | null }>(
      `/v1/parcel-orgs/me/dispatch/${encodeURIComponent(id)}`,
    );
    return res.dispatch;
  } catch {
    return null;
  }
}

/** Open a run: vehicle, leg, crew and receiving team in one call. */
export async function createDispatch(
  input: CreateDispatchInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await parcelOrgFetch<{ id: string }>("/v1/parcel-orgs/me/dispatch", {
      method: "POST",
      body: JSON.stringify({
        vehiclePlate: input.vehiclePlate.trim(),
        vehicleType: input.vehicleType,
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
    });
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
    await parcelOrgFetch(`/v1/parcel-orgs/me/dispatch/${encodeURIComponent(id)}/position`, {
      method: "POST",
      body: JSON.stringify({ lat, lng }),
    });
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** The receiving team's check-in: the run is over, who signed is on
 *  the record. Blank falls back to the named receiving team. */
export async function arriveDispatch(id: string, receivedBy: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/dispatch/${encodeURIComponent(id)}/arrive`, {
      method: "POST",
      body: JSON.stringify({ receivedBy: receivedBy.trim() }),
    });
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Call a run off before it arrives. */
export async function cancelDispatch(id: string): Promise<Result> {
  try {
    await parcelOrgFetch(`/v1/parcel-orgs/me/dispatch/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
