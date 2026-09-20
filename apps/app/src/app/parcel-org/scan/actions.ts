"use server";

import { revalidatePath } from "next/cache";
import {
  ParcelOrgRequestError,
  ParcelOrgUnauthorised,
  parcelOrgFetch,
  type OrgParcelLabel,
  type OrgParcelRow,
  type OrgShipment,
} from "@/lib/parcel-org-session";
import { stageFor, type ScanTarget } from "../parcel-stages";

/**
 * The scanner's own wires.
 *
 * One rule holds this file together: the SCANNER never asks the clerk
 * what a code is, and never offers an action the parcel's current state
 * can't accept. Everything below exists to make one of those two
 * statements true — `resolveScan` answers "what is this and what stage
 * is it at", and each action is exactly one stage transition with the
 * pre-step it needs already folded in.
 *
 * That folding is the point. See `handOverParcel`: handing a parcel to
 * its receiver is two server calls, and a clerk who only makes the
 * second one gets a flat refusal through no fault of their own.
 */

export type ScanFailure = { ok: false; error: string; errorCode?: string };

function toResult(e: unknown): ScanFailure {
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
 * One round trip, one verdict.
 *
 * Resolution order matters and is not arbitrary. A PKG- code can be a
 * blank sticker off the pad, a sticker already written on, or a sticker
 * long since spent on a real parcel — and the last of those has to
 * resolve to the PARCEL, not to the label, or a clerk scanning a box
 * mid-journey would be offered a booking form. So: labels first (they
 * are the only thing that can be blank), and a spent label immediately
 * forwards to the parcel it was spent on.
 *
 * A TCK- service ticket is the reference a sender holds BEFORE the
 * parcel has a tracking code at all, so it resolves to nothing here on
 * purpose — the receive action resolves it server-side (see
 * dbx.ScanHandoff) and hands back the real code.
 */
export async function resolveScan(raw: string): Promise<ScanTarget> {
  const code = raw.trim().toUpperCase();
  if (!code) return { kind: "unknown", code, reason: "Nothing was scanned." };

  if (code.startsWith("TCK-")) return { kind: "ticket", code };

  // Both lookups in parallel: a PKG- code is ambiguous until one of
  // them answers, and asking in sequence costs a clerk a round trip on
  // every single scan for no gain. Whichever resolves wins, label
  // first — see the ordering note above.
  const [label, parcel] = await Promise.all([
    parcelOrgFetch<{ label: OrgParcelLabel }>(
      `/v1/parcel-orgs/me/labels/resolve?code=${encodeURIComponent(code)}`,
    )
      .then((r) => r.label)
      .catch(() => null),
    parcelOrgFetch<{ parcels: OrgParcelRow[] | null }>(
      `/v1/parcel-orgs/me/parcels?q=${encodeURIComponent(code)}`,
    )
      .then((r) => r.parcels?.find((p) => p.code.toUpperCase() === code) ?? null)
      .catch(() => null),
  ]);

  if (parcel) {
    return {
      kind: "parcel",
      code: parcel.code,
      stage: stageFor(parcel.status),
      parcel,
    };
  }

  if (label) {
    if (label.voidedAt) {
      return {
        kind: "unknown",
        code,
        reason: label.voidedReason
          ? `This label was withdrawn — ${label.voidedReason}. Use a fresh sticker.`
          : "This label was withdrawn. Use a fresh sticker.",
      };
    }
    // A spent label whose parcel this company can't see is somebody
    // else's box carrying our sticker — rare, but it must not open a
    // booking form.
    if (label.usedAt && !label.parcelCode) {
      return {
        kind: "unknown",
        code,
        reason: "This label is already used, and its parcel isn't on your books.",
      };
    }
    const written =
      label.itemDescription || label.receiverName || label.destination;
    return written
      ? { kind: "filled-label", code: label.code, label }
      : { kind: "blank-label", code: label.code, label };
  }

  return {
    kind: "unknown",
    code,
    reason: "That code isn't one of your labels or your parcels.",
  };
}

/**
 * Take physical custody — the "Received" half of every receive button.
 *
 * `reference` is whatever the sender walked in with: pre-intake that is
 * the service ticket number, not the tracking code, because the code
 * does not exist to the sender yet. The server resolves either and
 * returns the REAL code, which is what has to go on the printed label.
 */
export async function receiveParcel(
  reference: string,
): Promise<{ ok: true; code: string; status: string } | ScanFailure> {
  try {
    const res = await parcelOrgFetch<{ status: string; code: string }>(
      `/v1/parcels/${encodeURIComponent(reference.trim())}/handoff`,
      { method: "POST" },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/scan");
    return { ok: true, code: res.code, status: res.status };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Put a received parcel onto a run that is actually leaving.
 *
 * Deliberately requires a shipment id rather than bumping the status on
 * its own. A parcel marked IN_TRANSIT with no run behind it tells the
 * receiver "it's on the way" about a box still sitting on the floor,
 * shows up nowhere on the dispatch board, and appears on no manifest
 * for the far end to check in against — three lies for the convenience
 * of one fewer tap. dbx.LoadParcelToShipment moves the status as part
 * of loading, which is the only place that transition is honest.
 */
export async function loadOntoRun(
  shipmentId: string,
  code: string,
): Promise<{ ok: true } | ScanFailure> {
  try {
    await parcelOrgFetch(
      `/v1/parcel-orgs/me/shipments/${encodeURIComponent(shipmentId)}/load`,
      { method: "POST", body: JSON.stringify({ code: code.trim() }) },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/dispatch");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** The company's runs that are still loading — refetched after each
 *  scan so a lorry that left while the clerk was typing disappears from
 *  the picker rather than failing on submit. */
export async function listOpenRuns(): Promise<OrgShipment[]> {
  try {
    const res = await parcelOrgFetch<{ shipments: OrgShipment[] | null }>(
      "/v1/parcel-orgs/me/shipments",
    );
    return res.shipments ?? [];
  } catch {
    // A picker that fails to load must not block receiving. The clerk
    // falls back to "Receive only", which is always available.
    return [];
  }
}

/** Open a run from the counter, for the case the picker is empty and a
 *  vehicle is at the door. Saves a trip to the dispatch board mid-queue. */
export async function openRun(input: {
  originLabel: string;
  destinationLabel: string;
  vehiclePlate?: string;
}): Promise<{ ok: true; shipment: OrgShipment } | ScanFailure> {
  try {
    const res = await parcelOrgFetch<{ shipment: OrgShipment }>(
      "/v1/parcel-orgs/me/shipments",
      {
        method: "POST",
        body: JSON.stringify({
          originLabel: input.originLabel.trim(),
          destinationLabel: input.destinationLabel.trim(),
          vehiclePlate: input.vehiclePlate?.trim() || "",
        }),
      },
    );
    revalidatePath("/parcel-org/dispatch");
    return { ok: true, shipment: res.shipment };
  } catch (e) {
    return toResult(e);
  }
}

export interface HandOverInput {
  code: string;
  /** The receiver's six digits. Empty when handing over by OTP, by
   *  agent collection, or under a staff override. */
  deliveryCode?: string;
  /** A one-time code sent to the number on the parcel — the route for
   *  "the SMS never arrived". */
  otpCode?: string;
  /** Who physically took the box. Frequently not the receiver (a
   *  watchman, a shop attendant, a neighbour) and the single most
   *  valuable line in any later dispute, so the scanner always asks. */
  receivedByName?: string;
  /** Cash taken, for a parcel the buyer pays for on delivery. */
  codCollectedKes?: number;
  photoKey?: string;
  lat?: number;
  lng?: number;
}

/**
 * The terminal hand-over — and the one action that folds in a pre-step.
 *
 * core-go refuses a delivery from anyone who is not the parcel's
 * `currentHolderPartyId`, and a parcel arriving at its destination is
 * very often held by nobody this clerk is: `LoadParcelToShipment` moves
 * a parcel to IN_TRANSIT without touching the holder, and a counter
 * intake by a login with no linked Party leaves it NULL outright. So a
 * clerk at the far end who scans an arriving box and presses "hand it
 * over" would get `FORBIDDEN — you aren't holding this parcel`, having
 * done nothing wrong and with no hint what to do about it.
 *
 * The fix is a custody scan first, which is also the honest record of
 * what physically happened: the box came off the vehicle into this
 * clerk's hands, and THEN went to the receiver. dbx.ScanHandoff treats
 * a re-scan by the current holder as a no-op, so doing this
 * unconditionally is safe and idempotent — it costs one call on the
 * parcels where the clerk already holds it, and rescues every parcel
 * where they don't.
 *
 * Only ever from a stage where the box is genuinely in the building
 * (`moving`, `held`, `failed`). A BOOKED parcel must not be swept into
 * custody by someone reaching for a delivery button.
 */
export async function handOverParcel(
  input: HandOverInput,
): Promise<{ ok: true; status: string } | ScanFailure> {
  const code = input.code.trim();
  try {
    // Step 1 — take custody. A failure here is reported as itself
    // rather than swallowed: if this clerk genuinely may not hold this
    // parcel, that is the real answer and delivering would fail anyway.
    await parcelOrgFetch(`/v1/parcels/${encodeURIComponent(code)}/handoff`, {
      method: "POST",
    });
  } catch (e) {
    const r = toResult(e);
    // Already delivered/closed is not a custody problem — let step 2
    // produce the accurate message for it.
    if (r.errorCode !== "BAD_INPUT" && r.errorCode !== "ALREADY_DELIVERED") {
      return r;
    }
  }

  try {
    const res = await parcelOrgFetch<{ status: string }>(
      `/v1/parcels/${encodeURIComponent(code)}/deliver`,
      {
        method: "POST",
        body: JSON.stringify({
          deliveryCode: input.deliveryCode?.trim() || "",
          otpCode: input.otpCode?.trim() || "",
          receivedByName: input.receivedByName?.trim() || null,
          codCollectedKes: input.codCollectedKes ?? null,
          photoKey: input.photoKey ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        }),
      },
    );
    revalidatePath("/parcel-org");
    revalidatePath("/parcel-org/scan");
    return { ok: true, status: res.status };
  } catch (e) {
    return toResult(e);
  }
}

/** Send a one-time code to the number on the parcel — the way out when
 *  the receiver is standing there and the delivery SMS never arrived,
 *  or when too many wrong codes have locked the six digits. */
export async function sendReceiverOtp(
  code: string,
): Promise<{ ok: true } | ScanFailure> {
  try {
    await parcelOrgFetch(
      `/v1/parcels/${encodeURIComponent(code.trim())}/deliver/request-otp`,
      { method: "POST" },
    );
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Record a delivery that didn't happen, so the parcel leaves the
 *  "on the road" count and somebody is told to call the receiver. */
export async function recordFailedAttempt(
  code: string,
  reason: string,
): Promise<{ ok: true } | ScanFailure> {
  try {
    await parcelOrgFetch(
      `/v1/parcels/${encodeURIComponent(code.trim())}/attempt`,
      { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Take the counter's cash for a walk-in booked to pay at the desk.
 *  Separate from receiving on purpose: custody and payment are
 *  different facts, and a box in hand should be recorded as such even
 *  while the sender is still counting out notes. */
export async function settleAtCounter(
  code: string,
  priceKes: number,
): Promise<{ ok: true } | ScanFailure> {
  try {
    await parcelOrgFetch(
      `/v1/parcels/${encodeURIComponent(code.trim())}/settle-counter`,
      { method: "POST", body: JSON.stringify({ priceKes }) },
    );
    revalidatePath("/parcel-org");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
