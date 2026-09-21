"use server";

import { revalidatePath } from "next/cache";
import {
  updateParcelPricingRule,
  type UpdateParcelPricingRuleInput,
} from "@esoqo/db";
import { requireStaff } from "@/lib/session";
import { adminGo, GoRequestError } from "@/lib/go-ticketing";

export type Result = { ok: true } | { ok: false; error: string };

export interface ParcelOpsQueueRow {
  code: string;
  status: string;
  receiverName: string;
  destinationLabel: string;
  perishable: boolean;
  expiryAt: string | null;
  declaredValueKes: string | null;
  reminderCount: number;
  createdAt: string;
}

export interface ParcelShipmentView {
  id: string;
  originLabel: string;
  destinationLabel: string;
  routeLabel: string;
  vehiclePlate: string;
  status: string;
  expected: number;
  loaded: number;
  offloaded: number;
}

export async function actionListParcelOpsQueue(
  queue = "all",
): Promise<ParcelOpsQueueRow[]> {
  await requireStaff();
  const { parcels } = await adminGo<{ parcels: ParcelOpsQueueRow[] | null }>(
    `/v1/admin/parcel-ops/queue?queue=${encodeURIComponent(queue)}`,
  );
  return parcels ?? [];
}

export async function actionCaptureParcelIntake(
  code: string,
  input: {
    itemCategory: string;
    itemDescription: string;
    perishable: boolean;
    perishableHandling?: string;
    expiryAt?: string;
    condition: string;
    declaredValueKes?: number;
  },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcel-ops/${encodeURIComponent(code)}/intake`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/operations");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not receive that parcel",
    };
  }
}

export async function actionRejectParcelAtDropoff(
  code: string,
  reason: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcel-ops/${encodeURIComponent(code)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    revalidatePath("/parcels/operations");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reject that parcel",
    };
  }
}

export async function actionCreateParcelShipment(input: {
  originLabel: string;
  destinationLabel: string;
  routeLabel?: string;
  vehiclePlate?: string;
  driverPartyId?: string;
  conductorPartyId?: string;
}): Promise<
  { ok: true; shipment: ParcelShipmentView } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const shipment = await adminGo<ParcelShipmentView>(
      "/v1/admin/parcel-ops/shipments",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    return { ok: true, shipment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create shipment",
    };
  }
}

async function shipmentAction(
  path: string,
): Promise<
  { ok: true; shipment: ParcelShipmentView } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const shipment = await adminGo<ParcelShipmentView>(path, {
      method: "POST",
    });
    return { ok: true, shipment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update shipment",
    };
  }
}

export async function actionLoadParcelToShipment(id: string, code: string) {
  return shipmentAction(
    `/v1/admin/parcel-ops/shipments/${encodeURIComponent(id)}/load/${encodeURIComponent(code)}`,
  );
}
export async function actionStartParcelShipment(id: string) {
  return shipmentAction(
    `/v1/admin/parcel-ops/shipments/${encodeURIComponent(id)}/start`,
  );
}
export async function actionOffloadParcelFromShipment(
  id: string,
  code: string,
) {
  return shipmentAction(
    `/v1/admin/parcel-ops/shipments/${encodeURIComponent(id)}/offload/${encodeURIComponent(code)}`,
  );
}
export async function actionFinishParcelShipment(id: string) {
  return shipmentAction(
    `/v1/admin/parcel-ops/shipments/${encodeURIComponent(id)}/finish`,
  );
}

export async function actionSendPickupReminder(code: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(
      `/v1/admin/parcel-ops/${encodeURIComponent(code)}/pickup-reminder`,
      { method: "POST" },
    );
    revalidatePath("/parcels/operations");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not send reminder",
    };
  }
}

export async function actionUpdateParcelPricing(
  parcelType: string,
  input: UpdateParcelPricingRuleInput,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateParcelPricingRule(ctx, parcelType, input);
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save that price",
    };
  }
}

export interface CollectorLite {
  PartyID: string;
  Name: string;
  Msisdn: string | null;
}

export async function actionSearchCollectors(
  q: string,
): Promise<CollectorLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { collectors } = await adminGo<{ collectors: CollectorLite[] | null }>(
    `/v1/admin/parcels/collectors?q=${encodeURIComponent(q)}`,
  );
  return collectors ?? [];
}

/** Any existing person on the platform, for the "add an existing person"
 *  picker on a company's team. Typeahead, so the caller debounces; blank
 *  returns nothing (a picker, not a people dump). */
export async function actionSearchParcelPeople(
  q: string,
): Promise<CollectorLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { people } = await adminGo<{ people: CollectorLite[] | null }>(
    `/v1/admin/parcels/people?q=${encodeURIComponent(q)}`,
  );
  return people ?? [];
}

/**
 * A clerk/handler's explicit "the box is physically here" moment —
 * the gate on the sender's and receiver's very first SMS about this
 * parcel. Booking it (self-service or a clerk typing a walk-in's
 * details in) never sends anything on its own; only this does.
 *
 * Calls the same custody-scan endpoint the courier-company Front Desk
 * uses (POST /v1/parcels/:code/handoff) — a dedicated /confirm-intake
 * route used to exist here but was retired as a duplicate of this one
 * and this action wasn't updated at the time, silently breaking the
 * Counter screen's "Confirm the box is here" button and
 * ParcelDetailModal's own confirm action. handleScanParcelHandoff's own
 * staffOverride path (parcels.override/parcels.assign) is exactly what
 * makes this safe for a staff session with no linked Party.
 */
export async function actionConfirmParcelIntake(code: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/parcels/${code}/handoff`, { method: "POST" });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Could not confirm that parcel was received",
    };
  }
}

export async function actionAssignParcelCollector(
  parcelId: string,
  input: { collectorPartyId: string; scheduledAt: string; note?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/assign`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Could not schedule that collection",
    };
  }
}

export interface BulkAssignOutcome {
  assigned: { parcelId: string; code: string }[];
  failed: { parcelId: string; error: string }[];
}

/**
 * Assign one collector to a whole selection — a rider's morning round
 * in one action instead of eight trips through the modal.
 *
 * Partial success is a normal outcome, not an error: each assignment
 * texts a sender and a courier the moment it lands, and those can't be
 * recalled, so core-go reports what it managed rather than pretending a
 * batch is atomic. The caller must show both halves.
 */
export async function actionBulkAssignParcels(
  parcelIds: string[],
  input: { collectorPartyId: string; scheduledAt: string; note?: string },
): Promise<
  { ok: true; result: BulkAssignOutcome } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const result = await adminGo<BulkAssignOutcome>(
      "/v1/admin/parcels/bulk-assign",
      {
        method: "POST",
        body: JSON.stringify({ parcelIds, ...input }),
      },
    );
    revalidatePath("/parcels");
    return { ok: true, result };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not assign those parcels",
    };
  }
}

export async function actionCancelParcel(
  parcelId: string,
  reason: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not cancel that parcel",
    };
  }
}

export async function actionMarkParcelRefunded(
  parcelId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/refund`, { method: "POST" });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Could not mark that refund as processed",
    };
  }
}

export interface HandoffRow {
  FromName: string | null;
  ToName: string;
  CreatedAt: string;
}

export async function actionGetParcelHandoffs(
  parcelId: string,
): Promise<HandoffRow[]> {
  await requireStaff();
  const { handoffs } = await adminGo<{ handoffs: HandoffRow[] | null }>(
    `/v1/admin/parcels/${parcelId}/handoffs`,
  );
  return handoffs ?? [];
}

export async function actionUpdateParcelDetails(
  parcelId: string,
  input: {
    receiverName: string;
    receiverMsisdn: string;
    destinationLabel: string;
    notes?: string;
  },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save those details",
    };
  }
}

export async function actionClearParcelException(
  parcelId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/exception/clear`, {
      method: "POST",
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not clear that exception",
    };
  }
}

// ── Unsticking a receiver who can't get past the delivery code ───────
//
// A superset of the same three verbs the carrying company's own
// console has: admin can resolve a stuck parcel for ANY carrier,
// including Esoqo-operated ones, which have no company console to act
// from at all. Keyed on the parcel id because this app works in ids
// throughout; core-go resolves the code.

/** Allow two more verification attempts. Refused once the parcel is
 *  hard locked — at that point only a new code moves it. */
export async function actionGrantReceiverAuthRetry(
  parcelId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/receiver-auth/grant-retry`, {
      method: "POST",
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not allow more tries",
    };
  }
}

/** Mint a new delivery code and clear every lock.
 *
 *  The code is never returned here and never rendered in this console.
 *  core-go texts it to the receiver and the sender; showing it on an
 *  operator's screen would make the one secret in this flow readable
 *  by anyone passing the desk. */
export async function actionReissueDeliveryCode(
  parcelId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/delivery-code/reissue`, {
      method: "POST",
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not issue a new code",
    };
  }
}

/** Pay out a delivery the receiver closed themselves at a pickup point,
 *  which held the accrual because no staff member witnessed it. */
export async function actionReleaseHeldCourierEarnings(
  parcelId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/courier-earnings/release`, {
      method: "POST",
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not release those earnings",
    };
  }
}

export async function actionFlagParcelException(
  parcelId: string,
  note: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/exception`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not flag that parcel",
    };
  }
}

// ── Couriers ──

export interface ParcelCourierRow {
  ID: string;
  PartyID: string;
  Name: string;
  Msisdn: string | null;
  VehicleType: string;
  Status: string;
  VettingNote: string | null;
  ActivatedAt: string | null;
  SuspendedAt: string | null;
  CreatedAt: string;
}

export interface CourierPerformance {
  deliveredCount: number;
  onTimeCount: number;
  avgConditionRating: number | null;
}

export async function actionListCouriers(
  status?: string,
  q?: string,
): Promise<ParcelCourierRow[]> {
  await requireStaff();
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const { couriers } = await adminGo<{ couriers: ParcelCourierRow[] | null }>(
    `/v1/admin/parcels/couriers?${params.toString()}`,
  );
  return couriers ?? [];
}

export async function actionSearchOnboardCandidates(
  q: string,
): Promise<CollectorLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { candidates } = await adminGo<{ candidates: CollectorLite[] | null }>(
    `/v1/admin/parcels/couriers/candidates?q=${encodeURIComponent(q)}`,
  );
  return candidates ?? [];
}

export async function actionOnboardCourier(
  partyId: string,
  vehicleType: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/couriers", {
      method: "POST",
      body: JSON.stringify({ partyId, vehicleType }),
    });
    revalidatePath("/parcels/couriers");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not onboard that courier",
    };
  }
}

// The "just add them" path for a courier team member who's never
// signed up on their own — unlike actionOnboardCourier (which turns an
// *existing* Party, found by search, into a courier), this creates the
// account too, straight from name/phone/vehicle. core-go texts the new
// courier their Esoqo ID the moment the account exists — see
// notify.CourierOnboarded — so this doubles as phone-number
// confirmation: if the text never lands, the number was wrong.
export async function actionAddCourierTeamMember(input: {
  name: string;
  msisdn: string;
  email?: string;
  vehicleType: string;
}): Promise<{ ok: true; esoqoId: string } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { esoqoId } = await adminGo<{ esoqoId: string }>(
      "/v1/admin/parcels/courier-team",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    revalidatePath("/parcels/couriers");
    return { ok: true, esoqoId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not add that courier",
    };
  }
}

export async function actionSetCourierStatus(
  courierId: string,
  status: string,
  note?: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/couriers/${courierId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    });
    revalidatePath("/parcels/couriers");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that courier",
    };
  }
}

// Keyed by partyId in the query string — the Go handler resolves
// performance by joining parcel.currentHolderPartyId directly, not by
// the courier row's own id, so the :id path segment here is a
// placeholder the route needs but the handler doesn't read.
export async function actionGetCourierPerformance(
  partyId: string,
): Promise<CourierPerformance> {
  await requireStaff();
  return adminGo<CourierPerformance>(
    `/v1/admin/parcels/couriers/${partyId}/performance?partyId=${encodeURIComponent(partyId)}`,
  );
}

// ── Zones & distance pricing ──

export interface ParcelZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  active: boolean;
}

export async function actionListParcelZones(): Promise<ParcelZone[]> {
  await requireStaff();
  const { zones } = await adminGo<{ zones: ParcelZone[] | null }>(
    "/v1/admin/parcels/zones",
  );
  return zones ?? [];
}

export async function actionCreateParcelZone(
  name: string,
  lat: number,
  lng: number,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/zones", {
      method: "POST",
      body: JSON.stringify({ name, lat, lng }),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create that zone",
    };
  }
}

export async function actionUpdateParcelZone(
  id: string,
  name: string,
  lat: number,
  lng: number,
  active: boolean,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/zones/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, lat, lng, active }),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that zone",
    };
  }
}

/** A courier company operating on Esoqo. commissionPct is Esoqo's cut
 *  of every parcel it carries — copied onto each parcel at payment time
 *  and never read live, so renegotiating a rate can't rewrite what an
 *  already-paid parcel earned. */
export interface ParcelOrg {
  id: string;
  enterpriseId: string;
  name: string;
  slug: string;
  status: string;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  settlementPhone: string | null;
  commissionPct: number;
  /** The one physical front desk a sender can walk into — see the
   *  schema's own comment on ParcelOrg.acceptsWalkIn. */
  acceptsWalkIn: boolean;
  lat: number | null;
  lng: number | null;
  locationHint: string | null;
  openingHours: string | null;
  /** Co-branded label assets. logoUrl prints centered in the label
   *  header; null = Esoqo branding alone. */
  logoStorageKey?: string | null;
  logoUrl?: string | null;
  brandAccent?: string | null;
  // ── Register enrichment (admin list/detail only) ───────────────────
  /** The registered business that owns the company. Distinct from the
   *  contact person: the business outlives whoever is on the roster. */
  enterpriseName?: string;
  ownerPartyId?: string;
  staffCount?: number;
  activeStaff?: number;
  parcelCount?: number;
  deliveredCount?: number;
  /** Decimal string from core-go — parse before doing money maths. */
  earningsKes?: string;
  /** First MANAGER on the roster (else the legacy contact fields), kept
   *  separate from the company on purpose. */
  primaryContactName?: string | null;
  primaryContactPhone?: string | null;
}

export interface ParcelOrgInput {
  enterpriseId?: string;
  name: string;
  slug: string;
  status: string;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  settlementPhone?: string | null;
  commissionPct: number;
  acceptsWalkIn: boolean;
  lat?: number | null;
  lng?: number | null;
  locationHint?: string | null;
  openingHours?: string | null;
  logoStorageKey?: string | null;
  logoUrl?: string | null;
  brandAccent?: string | null;
}

export interface EnterpriseLite {
  id: string;
  name: string;
  partyId: string;
  msisdn: string | null;
}

export async function actionListParcelOrgs(): Promise<ParcelOrg[]> {
  await requireStaff();
  const { orgs } = await adminGo<{ orgs: ParcelOrg[] | null }>(
    "/v1/admin/parcels/orgs",
  );
  return orgs ?? [];
}

/** A courier company hangs off an Enterprise exactly as a Store and a
 *  TicketOrg do, so onboarding one means naming the business that runs
 *  it. A blank query returns nothing — this is a picker, not a list of
 *  every business on the platform. */
export async function actionSearchEnterprises(
  q: string,
): Promise<EnterpriseLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { enterprises } = await adminGo<{
    enterprises: EnterpriseLite[] | null;
  }>(`/v1/admin/parcels/enterprises?q=${encodeURIComponent(q)}`);
  return enterprises ?? [];
}

/**
 * When the search above finds nothing — the common case for a courier
 * company's first onboarding, since the only other way a business
 * lands in `enterprise` is self-registering through the public /join
 * flow, OTP and all. Staff onboarding a real company in person can
 * register the owning business directly instead of being stuck; see
 * dbx.CreateEnterpriseForCourierOrg's own comment.
 */
export async function actionCreateEnterprise(
  name: string,
): Promise<
  { ok: true; id: string; name: string } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const res = await adminGo<{ id: string; name: string }>(
      "/v1/admin/parcels/enterprises",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );
    return { ok: true, id: res.id, name: res.name };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create that business",
    };
  }
}

export async function actionCreateParcelOrg(
  input: ParcelOrgInput,
  members: OrgMemberInput[] = [],
): Promise<Result> {
  try {
    await requireStaff();
    const { id } = await adminGo<{ id: string }>("/v1/admin/parcels/orgs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    // Add the roster in the same onboarding step. Sequential rather than
    // a single bulk call so each member takes the exact upsert/invite/
    // PIN-provisioning path the Team manager uses later — and a failure
    // names the person it stopped on, since the company itself has
    // already been created by this point.
    for (const m of members) {
      if (!m.name.trim()) continue;
      try {
        await adminGo(`/v1/admin/parcels/orgs/${id}/staff`, {
          method: "POST",
          body: JSON.stringify({
            name: m.name.trim(),
            role: m.role,
            pin: m.pin ?? "",
            msisdn: m.msisdn?.trim() || null,
            esokoId: m.esokoId?.trim() || null,
            isContact: m.isContact ?? false,
            capabilities: m.capabilities ?? [],
          }),
        });
      } catch (e) {
        throw new Error(
          `The company was created, but adding ${m.name.trim()} failed: ` +
            (e instanceof Error ? e.message : "unknown error") +
            ". Add them from the company's Team section.",
        );
      }
    }
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/parcel-co/${input.slug}`;
    const message = `ESOQO PARCEL: ${input.name} has been created. Staff sign in at ${portalUrl}. Your company manager will receive access separately.`;
    if (input.contactEmail) {
      const { sendEmail } = await import("@esoqo/auth");
      await sendEmail(
        input.contactEmail,
        "Your ESOQO PARCEL company profile is ready",
        message,
      );
    }
    if (input.contactPhone) {
      const { sendSms } = await import("@esoqo/auth");
      await sendSms(input.contactPhone, message, "PARCEL_COMPANY_CREATED");
    }
    revalidatePath("/parcels/companies");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create that company",
    };
  }
}

export async function actionUpdateParcelOrg(
  id: string,
  input: ParcelOrgInput,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/orgs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/companies");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that company",
    };
  }
}

/**
 * Company logo for co-branded labels.
 *
 * Stored via the shared R2/local storage (same putObject pipeline group
 * documents use) and referenced by URL — core-go only keeps the string.
 * PNG/JPG under 2MB; printed centered in the label header at fixed mm
 * sizes, never over QR/barcode pixels. Removing = back to Esoqo alone.
 */
export async function actionUploadParcelOrgLogo(
  form: FormData,
): Promise<
  | { ok: true; storageKey: string; url: string }
  | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file was attached" };
    if (file.size > 2 * 1024 * 1024) return { ok: false, error: "Keep the logo under 2 MB" };
    const { sniff, makeStorageKey, putObject } = await import("@esoqo/db");
    const buf = Buffer.from(await file.arrayBuffer());
    const check = sniff(buf, file.type, file.name);
    if (!check.ok || !check.mime || !check.mime.startsWith("image/")) {
      return { ok: false, error: check.reason ?? "Use a PNG or JPG logo" };
    }
    const storageKey = makeStorageKey(check.mime);
    await putObject(storageKey, buf);
    return { ok: true, storageKey, url: `/img/${storageKey}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "That upload didn't go through",
    };
  }
}

export interface ParcelOrgStaffRow {
  id: string;
  orgId: string;
  name: string;
  role: string;
  active: boolean;
  /** One of the company's contact people. Multiple are allowed; the
   *  register's Contact column prefers these over the first manager. */
  isContact: boolean;
  partyId: string | null;
  stationId: string | null;
  /** The phone and the ESK-… handle this person signs in with — the two
   *  credentials an admin reads back to someone locked out. */
  msisdn: string | null;
  esoqoId: string | null;
  /** A custom ("Other…") role's explicit permissions. Empty for a preset
   *  role, whose bundle is resolved from `role` at sign-in. */
  capabilities: string[];
}

/** One roster member entered during company onboarding. Mirrors the
 *  fields TeamManager's add form takes, so each member goes through the
 *  exact same core-go upsert/invite/PIN-provisioning path afterwards. */
export interface OrgMemberInput {
  name: string;
  role: string;
  pin?: string;
  msisdn?: string;
  esokoId?: string;
  isContact?: boolean;
  capabilities?: string[];
}

/** A company's own audit trail, read straight off the append-only
 *  audit_event chain. Newest first. */
export interface ParcelOrgActivityRow {
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown> | null;
}

export interface ParcelOrgStats {
  awaitingPickup: number;
  inTransit: number;
  failedDeliveries: number;
  atAgent: number;
  deliveredToday: number;
  earningsTodayKes: string;
  earningsKes: string;
  awaitingDropoff: number;
}

export interface ParcelOrgDetail {
  org: ParcelOrg;
  stats: ParcelOrgStats;
  staff: ParcelOrgStaffRow[];
  activity: ParcelOrgActivityRow[];
}

/** One company's full detail view: the company, its numbers, its roster
 *  (with each member's Esoqo ID), and its activity feed. */
export async function actionGetParcelOrgDetail(
  id: string,
): Promise<ParcelOrgDetail> {
  await requireStaff();
  const detail = await adminGo<ParcelOrgDetail>(
    `/v1/admin/parcels/orgs/${encodeURIComponent(id)}`,
  );
  // core-go serialises a nil Go slice as JSON null, not [] — a company
  // with no roster or no audit rows comes back that way, and the page
  // reads .length/.map on both. Normalise here (same convention
  // actionListParcelOrgStaff already follows) rather than making every
  // caller null-check a field typed as an array.
  return {
    ...detail,
    staff: detail.staff ?? [],
    activity: detail.activity ?? [],
  };
}

export async function actionListParcelOrgStaff(
  orgId: string,
): Promise<ParcelOrgStaffRow[]> {
  await requireStaff();
  const { staff } = await adminGo<{ staff: ParcelOrgStaffRow[] | null }>(
    `/v1/admin/parcels/orgs/${orgId}/staff`,
  );
  return staff ?? [];
}

/** Mint (or read back) the ESK-… handle a roster member signs in with.
 *  Needed for members created before the invite flow minted IDs — they
 *  have a Party and a phone but no code, which is the "can't see their
 *  Esoqo ID" gap. Idempotent on the server. */
export async function actionIssueParcelOrgStaffId(
  orgId: string,
  staffId: string,
): Promise<{ ok: true; esoqoId: string } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const res = await adminGo<{ esoqoId: string }>(
      `/v1/admin/parcels/orgs/${orgId}/staff/${staffId}/issue-id`,
      { method: "POST" },
    );
    revalidatePath("/parcels/companies");
    return { ok: true, esoqoId: res.esoqoId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not issue that Esoqo ID",
    };
  }
}

/** Seeds a company's first manager so somebody there can sign in and
 *  create the rest of the team themselves — the handover point between
 *  Esoqo onboarding a tenant and that tenant running itself.
 *
 *  Two ways in: a PIN for the dedicated company portal, or an msisdn to
 *  invite the person by phone instead — core-go resolves/creates their
 *  Party and texts them a sign-in link plus a first PIN (the typed one,
 *  or a temporary one when none is typed), so `pin` and `msisdn` are
 *  alternatives, not both required. The invitee signs in with that PIN
 *  and then resets it. */
export async function actionCreateParcelOrgManager(
  orgId: string,
  input: {
    /** Present when editing an existing roster member rather than adding
     *  one — core-go updates in place, leaving the PIN alone unless a new
     *  one is sent. */
    id?: string;
    name: string;
    role: string;
    pin?: string;
    msisdn?: string;
    esokoId?: string;
    partyId?: string | null;
    active?: boolean;
    isContact?: boolean;
    stationId?: string | null;
    /** A custom role's permissions. Sent as an array (possibly empty) so
     *  switching back to a preset clears them; omitted on paths that
     *  don't touch permissions. */
    capabilities?: string[];
  },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/orgs/${orgId}/staff`, {
      method: "POST",
      body: JSON.stringify({
        id: input.id ?? null,
        name: input.name,
        role: input.role,
        pin: input.pin ?? "",
        msisdn: input.msisdn ?? null,
        esokoId: input.esokoId ?? null,
        partyId: input.partyId || null,
        active: input.active ?? true,
        // Undefined (not false) on an update so core-go leaves the flag
        // alone rather than clearing it — see toggling a suspension.
        isContact: input.isContact,
        // Undefined here means "don't touch permissions" (a suspend),
        // which is exactly right; the edit form always sends its list.
        capabilities: input.capabilities,
        stationId: input.stationId ?? null,
      }),
    });
    revalidatePath("/parcels/companies");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save that person",
    };
  }
}

/** Hands a parcel to a courier company, or ('' ) takes it back to
 *  Esoqo-operated dispatch. Refused once the parcel is paid for — the
 *  revenue split is frozen against whoever was carrying it then. */
export async function actionAssignParcelOrg(
  parcelId: string,
  parcelOrgId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/org`, {
      method: "POST",
      body: JSON.stringify({ parcelOrgId }),
    });
    revalidatePath("/parcels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reassign that parcel",
    };
  }
}

// ── Courier earnings and payouts ─────────────────────────────────────

/** The one global rate a gig courier is paid. The two components stack:
 *  a flat amount per delivery plus a percentage of the delivery fee.
 *  Either may be zero. */
export interface CourierTariff {
  // Money is decimal strings; pctOfPrice is a rate, so it stays a number.
  perDeliveryKes: string;
  pctOfPrice: number;
  maxPerDeliveryKes: string;
}

export async function actionGetCourierTariff(): Promise<CourierTariff> {
  await requireStaff();
  return adminGo<CourierTariff>("/v1/admin/parcels/couriers/tariff");
}

export async function actionSetCourierTariff(
  input: CourierTariff,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/couriers/tariff", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/payouts");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save that rate",
    };
  }
}

export interface CourierOwed {
  courierPartyId: string;
  name: string;
  msisdn: string | null;
  // owedKes is a decimal string — see @esoqo/domain's money module.
  parcelCount: number;
  owedKes: string;
}

export async function actionListCouriersOwed(): Promise<CourierOwed[]> {
  await requireStaff();
  const { couriers } = await adminGo<{ couriers: CourierOwed[] | null }>(
    "/v1/admin/parcels/couriers/owed",
  );
  return couriers ?? [];
}

/** Paying a courier. amountKes is what was actually sent, which the
 *  record keeps alongside what the deliveries said was owed — a part
 *  payment or an agreed deduction is exactly what those two columns
 *  exist to show. */
export async function actionPayCourier(
  courierPartyId: string,
  amountKes: string,
  reference?: string,
  note?: string,
): Promise<
  | { ok: true; expectedKes: string; shortfallKes: string }
  | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const res = await adminGo<{ expectedKes: string; shortfallKes: string }>(
      "/v1/admin/parcels/couriers/payout",
      {
        method: "POST",
        body: JSON.stringify({
          courierPartyId,
          amountKes,
          reference: reference || null,
          note: note || null,
        }),
      },
    );
    revalidatePath("/parcels/payouts");
    return {
      ok: true,
      expectedKes: res.expectedKes,
      shortfallKes: res.shortfallKes,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record that payout",
    };
  }
}

// ── Cash on delivery ─────────────────────────────────────────────────

export interface CodPolicy {
  enabled: boolean;
  maxAmountKes: string;
  handlingFeePct: number;
}

export async function actionGetCodPolicy(): Promise<CodPolicy> {
  await requireStaff();
  return adminGo<CodPolicy>("/v1/admin/parcels/cod/policy");
}

export async function actionSetCodPolicy(input: CodPolicy): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/cod/policy", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/cod");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save those settings",
    };
  }
}

/** One seller waiting to be paid. `readyKes` is the portion a rider has
 *  actually handed in — money still in a pocket is owed but not yet
 *  Esoqo's to pay out, and showing one number for both would invite
 *  paying out cash nobody has counted. */
export interface SellerOwedCod {
  senderPartyId: string;
  senderName: string;
  senderMsisdn: string;
  // goodsKes/readyKes are decimal strings — see @esoqo/domain's money module.
  parcelCount: number;
  goodsKes: string;
  readyKes: string;
}

export async function actionListSellersOwedCod(): Promise<SellerOwedCod[]> {
  await requireStaff();
  const { sellers } = await adminGo<{ sellers: SellerOwedCod[] | null }>(
    "/v1/admin/parcels/cod/sellers",
  );
  return sellers ?? [];
}

export async function actionSettleSellerCod(
  senderPartyId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/cod/settle", {
      method: "POST",
      body: JSON.stringify({ senderPartyId }),
    });
    revalidatePath("/parcels/cod");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not settle that seller",
    };
  }
}

/** Counting a rider's cash in. amountKes is what was actually counted,
 *  which the server compares against what the parcels say it should
 *  have been — a short hand-over is the whole reason the record exists. */
export async function actionRemitCod(
  riderPartyId: string,
  amountKes: number,
  note?: string,
): Promise<
  | { ok: true; expectedKes: string; shortfallKes: string }
  | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const res = await adminGo<{ expectedKes: string; shortfallKes: string }>(
      "/v1/admin/parcels/cod/remit",
      {
        method: "POST",
        body: JSON.stringify({ riderPartyId, amountKes, note: note || null }),
      },
    );
    revalidatePath("/parcels/cod");
    return {
      ok: true,
      expectedKes: res.expectedKes,
      shortfallKes: res.shortfallKes,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record that hand-over",
    };
  }
}

/** A neighbourhood pickup point — the agent-network leg. See Go's
 *  parcel_agents.go for why agent-to-agent is the only leg cheap enough
 *  to compete on price in this market. */
export interface ParcelAgent {
  id: string;
  name: string;
  partyId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  lat: number;
  lng: number;
  msisdn: string;
  locationHint: string;
  openingHours: string | null;
  active: boolean;
  capacity: number;
  holdingFeeKes: string;
  parcelsHeld: number;
}

export interface ParcelAgentInput {
  name: string;
  zoneId?: string | null;
  lat: number;
  lng: number;
  msisdn: string;
  locationHint: string;
  openingHours?: string | null;
  capacity: number;
  holdingFeeKes: string;
  active: boolean;
}

export async function actionListParcelAgents(): Promise<ParcelAgent[]> {
  await requireStaff();
  // Inactive shops included, unlike the public list — the whole point
  // of the admin view is seeing the ones that are switched off.
  const { agents } = await adminGo<{ agents: ParcelAgent[] | null }>(
    "/v1/admin/parcels/agents",
  );
  return agents ?? [];
}

export async function actionCreateParcelAgent(
  input: ParcelAgentInput,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/agents", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Could not create that pickup point",
    };
  }
}

export async function actionUpdateParcelAgent(
  id: string,
  input: ParcelAgentInput,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Could not update that pickup point",
    };
  }
}

/** One cover level. The fee a sender pays is feeKes + declaredValue ×
 *  feePct, and maxCoverKes caps what a claim can ever pay out. */
export interface ParcelCoverageTier {
  id: string;
  name: string;
  // Decimal strings from core-go; feePct is a rate, so it stays a number.
  maxCoverKes: string;
  feeKes: string;
  feePct: number;
  active: boolean;
  sortOrder: number;
}

export async function actionListCoverageTiers(): Promise<ParcelCoverageTier[]> {
  await requireStaff();
  const { tiers } = await adminGo<{ tiers: ParcelCoverageTier[] | null }>(
    "/v1/admin/parcels/coverage",
  );
  return tiers ?? [];
}

/** Upsert by name, matching the server — the rate card is a small named
 *  set an admin edits in place, not a growing collection. */
export async function actionSaveCoverageTier(
  input: Omit<ParcelCoverageTier, "id">,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/coverage", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save that cover level",
    };
  }
}

export interface ParcelDistanceRate {
  perKmKes: string;
  minChargeableKm: number;
}

export async function actionGetDistanceRate(): Promise<ParcelDistanceRate | null> {
  await requireStaff();
  const { rate } = await adminGo<{ rate: ParcelDistanceRate | null }>(
    "/v1/admin/parcels/distance-rate",
  );
  return rate;
}

export async function actionSetDistanceRate(
  perKmKes: number,
  minChargeableKm: number,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo("/v1/admin/parcels/distance-rate", {
      method: "POST",
      body: JSON.stringify({ perKmKes, minChargeableKm }),
    });
    revalidatePath("/parcels/pricing");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Could not save the distance rate",
    };
  }
}

// ── Pre-printed label stock ──
// A pool of blank PKG-… codes minted ahead of any booking — print a
// batch, stick them on envelopes/boxes in advance, then a booking's
// existingCode binds one to a real shipment the moment it's needed.
// See dbx.ParcelLabelStock's own comment for the full rationale.

export interface ParcelLabelStockRow {
  code: string;
  createdAt: string;
  /** The truncated MAC core-go computed for this code, printed in the
   *  QR as k=. Empty on nothing — every listed label gets one — but the
   *  printer degrades gracefully if it ever is. */
  sig?: string;
}

/**
 * Mint a pad. `parcelOrgId` is who it's printed for — omitted mints
 * into the shared Esoqo pool, which is every label to date.
 *
 * Ownership is recorded here and enforced at bind time: core-go's
 * BookParcel refuses a code whose owning company isn't the one the
 * binder is signed in to. That's the induction check the freight
 * industry has always used on pre-numbered waybill pads — printing is
 * not a commitment, presenting the label against a shipment is.
 */
export async function actionGenerateParcelLabels(
  count: number,
  parcelOrgId?: string,
): Promise<
  { ok: true; codes: string[]; labels: { code: string; sig: string }[]; batchId: string } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const res = await adminGo<{
      codes: string[] | null;
      labels?: { code: string; sig: string }[] | null;
      batchId: string;
    }>("/v1/admin/parcels/labels/generate", {
      method: "POST",
      body: JSON.stringify({ count, parcelOrgId: parcelOrgId || undefined }),
    });
    revalidatePath("/parcels/labels");
    const codes = res.codes ?? [];
    // Backend now returns signed labels directly so the first print is
    // already genuine; fall back to unsigned codes for older servers.
    const labels = res.labels ?? codes.map((code) => ({ code, sig: '' }));
    return { ok: true, codes, labels, batchId: res.batchId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not generate labels",
    };
  }
}

export async function actionListParcelLabelStock(
  parcelOrgId?: string,
): Promise<ParcelLabelStockRow[]> {
  await requireStaff();
  const params = new URLSearchParams({ limit: "200" });
  if (parcelOrgId) params.set("parcelOrgId", parcelOrgId);
  const { labels } = await adminGo<{ labels: ParcelLabelStockRow[] | null }>(
    `/v1/admin/parcels/labels?${params}`,
  );
  return labels ?? [];
}

export interface ParcelLabelProjection {
  code: string;
  originLabel: string;
  destinationLabel: string;
  orgName: string | null;
  orgLogoUrl: string | null;
  sig: string;
}

/**
 * A booked parcel's own label for reprinting — signature + company
 * branding resolved server-side, so the sticker is genuine with the pad
 * owner's logo (Esoqo alone for shared pool). Null when the parcel
 * isn't visible to this staff member.
 */
export async function actionGetParcelLabel(
  code: string,
): Promise<ParcelLabelProjection | null> {
  try {
    await requireStaff();
    const label = await adminGo<ParcelLabelProjection>(
      `/v1/parcels/${encodeURIComponent(code)}/label`,
    );
    return label;
  } catch {
    return null;
  }
}

export interface TripManifestRow {
  code: string;
  receiverName: string;
  receiverMsisdn: string;
  destinationLabel: string;
  dropStageName: string | null;
  dropStageOrder: number | null;
  codAmountKes: string | null;
  codStatus: string;
}

/**
 * What is in the vehicle, in the order it comes off.
 *
 * The endpoint behind this has existed the whole time and no web
 * surface ever called it, so a driver left the depot without a signed
 * list of what they were carrying. Paper matters here for a reason the
 * app cannot cover: a signature survives a dispute six weeks later,
 * when the phone that recorded everything has been replaced.
 */
export async function actionGetTripManifest(
  tripId: string,
): Promise<TripManifestRow[]> {
  await requireStaff();
  const { parcels } = await adminGo<{ parcels: TripManifestRow[] | null }>(
    `/v1/admin/parcels/trips/${encodeURIComponent(tripId)}/manifest`,
  );
  return parcels ?? [];
}

export interface ParcelLabelRegisterRow {
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
  parcelOrgId?: string;
  sig?: string;
}

/**
 * Every label, in whatever state it has reached.
 *
 * The listing this replaces only ever showed never-touched stock, so
 * filling a label in made it disappear from the product — a handler
 * could record what a box was and where it was going, and no screen
 * would show it again.
 */
export async function actionListParcelLabelRegister(
  state: string,
  parcelOrgId?: string,
): Promise<{
  labels: ParcelLabelRegisterRow[];
  counts: Record<string, number>;
}> {
  await requireStaff();
  const params = new URLSearchParams({ state });
  if (parcelOrgId) params.set("parcelOrgId", parcelOrgId);
  const res = await adminGo<{
    labels: ParcelLabelRegisterRow[] | null;
    counts: Record<string, number>;
  }>(`/v1/admin/parcels/labels/register?${params}`);
  return { labels: res.labels ?? [], counts: res.counts ?? {} };
}

export interface ParcelLabelBatchRow {
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

export async function actionListParcelLabelBatches(
  parcelOrgId?: string,
): Promise<ParcelLabelBatchRow[]> {
  await requireStaff();
  const params = new URLSearchParams();
  if (parcelOrgId) params.set("parcelOrgId", parcelOrgId);
  const { batches } = await adminGo<{ batches: ParcelLabelBatchRow[] | null }>(
    `/v1/admin/parcels/labels/batches?${params}`,
  );
  return batches ?? [];
}

/**
 * Withdraw every still-usable label in a batch — the "a pad walked out
 * of the branch" button.
 *
 * Already-spent codes are deliberately left alone: each is bound to a
 * real parcel somewhere in the world being delivered, and retro-voiding
 * its label would invalidate the tracking code on a box in transit to
 * punish a theft that happened after it shipped.
 */
export async function actionVoidParcelLabelBatch(
  batchId: string,
  reason: string,
  parcelOrgId?: string,
): Promise<{ ok: true; voided: number } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { voided } = await adminGo<{ voided: number }>(
      `/v1/admin/parcels/labels/batches/${encodeURIComponent(batchId)}/void`,
      {
        method: "POST",
        body: JSON.stringify({ reason, parcelOrgId: parcelOrgId || undefined }),
      },
    );
    revalidatePath("/parcels/labels");
    return { ok: true, voided };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not withdraw that batch",
    };
  }
}

/**
 * Discard an explicit selection of unused labels — the "these three
 * misprinted, that strip got wet" path, as opposed to voiding a whole
 * batch. Live-only on the server: spent codes stay on their parcels,
 * unknown ones are ignored, and the count says how many went.
 */
export async function actionVoidParcelLabels(
  codes: string[],
  reason: string,
  parcelOrgId?: string,
): Promise<{ ok: true; voided: number } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { voided } = await adminGo<{ voided: number }>(
      `/v1/admin/parcels/labels/void`,
      {
        method: "POST",
        body: JSON.stringify({ codes, reason, parcelOrgId: parcelOrgId || undefined }),
      },
    );
    revalidatePath("/parcels/labels");
    return { ok: true, voided };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not withdraw those labels",
    };
  }
}

// Structured info attached to a pre-printed label — item, destination,
// sender/receiver name and contact, item type, weight range — the
// moment it's actually stuck on a physical item, independent of (and
// usually well before) a real booking. core-go's GET /v1/parcels/:code/status then
// surfaces this same info to anyone who scans/tracks the code, on the
// web track page and the mobile app's scan flow alike (see
// dbx.GetParcelStatus's own comment on the fallback). Every field but
// itemDescription is optional — a handler might only know the item
// and destination at first.
export interface ParcelLabelInfoInput {
  itemDescription: string;
  destination?: string;
  senderName?: string;
  senderMsisdn?: string;
  receiverName?: string;
  receiverMsisdn?: string;
  itemType?: string;
  weightRangeKg?: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

/**
 * Book a parcel from the counter.
 *
 * The admin console could do everything to a parcel except create one:
 * 48 actions for assigning, cancelling, refunding and flagging, and no
 * way to take one in over a desk. `POST /v1/parcels` existed the whole
 * time but was only ever reached from the customer web flow.
 *
 * Goes through the same endpoint that flow uses rather than a private
 * admin one, so a counter booking and a self-service booking are the
 * same kind of object with the same validation. What differs is only
 * what the session proves: the staff bearer is what lets this bind
 * owned label stock and attest the contents declaration.
 */
export interface CounterBookingInput {
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

export async function actionCounterBookParcel(
  input: CounterBookingInput,
): Promise<
  | { ok: true; code: string; parcelId: string }
  | { ok: false; error: string; errorCode?: string }
> {
  try {
    await requireStaff();
    // payAtCounter: true — a counter booking has a customer standing at
    // the desk settling in person, right now. Without this the parcel
    // was landing in DRAFT_PENDING_PAYMENT and just sitting there:
    // nobody was ever routed through SetParcelPrice/Pay to finish it, so
    // it never became a real, actionable BOOKED parcel and neither party
    // was ever texted. See dbx.BookParcelInput.PayAtCounter.
    const res = await adminGo<{ parcelId: string; code: string }>(
      "/v1/parcels",
      {
        method: "POST",
        body: JSON.stringify({ ...input, payAtCounter: true }),
      },
    );
    revalidatePath("/parcels");
    revalidatePath("/parcels/labels");
    return { ok: true, code: res.code, parcelId: res.parcelId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not book that parcel",
      // Forwarded so the offline queue can branch on LABEL_ALREADY_SPENT
      // rather than on the message text — see GoRequestError. Named
      // errorCode because the success shape's `code` is a parcel code.
      ...(e instanceof GoRequestError ? { errorCode: e.code } : {}),
    };
  }
}

export interface CounterParty {
  name: string;
  msisdn: string;
  lastLabel: string;
  lastSeen: string;
  shipments: number;
}

/**
 * Somebody this network has shipped to or from before.
 *
 * A market trader ships to the same six shops every week, and retyping
 * a name and number they gave you on Tuesday is the slowest part of a
 * counter transaction. Backed by past parcels rather than a saved-
 * addresses table — every parcel already records both parties, so an
 * address book would be a second copy of facts we hold, needing a dual
 * write and starting empty for every customer already in the system.
 */
export async function actionSearchCounterParties(
  q: string,
): Promise<CounterParty[]> {
  await requireStaff();
  if (q.trim().length < 3) return [];
  const { parties } = await adminGo<{ parties: CounterParty[] | null }>(
    `/v1/admin/parcels/parties?q=${encodeURIComponent(q.trim())}`,
  );
  return parties ?? [];
}

export interface ParcelPricingOption {
  parcelType: string;
  weightLabel: string;
  minWeightKg: number;
  maxWeightKg: number;
  minKes: string;
  maxKes: string;
}

/** Every weight bracket, so the counter can match a measured weight to
 *  its bracket without a round trip per keystroke. */
export async function actionListParcelPricing(): Promise<
  ParcelPricingOption[]
> {
  await requireStaff();
  const res = await adminGo<{ pricing: ParcelPricingOption[] | null }>(
    "/v1/parcels/pricing",
  );
  return res.pricing ?? [];
}

// ── Scanning ──

/**
 * Where should a scanned code take an operator?
 *
 * Deliberately built on the public GET /v1/parcels/:code/status rather
 * than a new admin endpoint, because that projection already answers
 * exactly this question: it resolves a booked parcel *and* falls back
 * to pre-printed label stock (see dbx.GetParcelStatus's own comment on
 * the fallback), which is the whole distinction the scan box needs.
 * A blank label and a booked parcel are the two things a handler
 * scans, and one lookup already tells them apart.
 *
 * The projection is guest-safe, so nothing here widens what admin can
 * see — this is a routing decision, and the destination pages do their
 * own capability checks as they always have.
 */
export type ScanDestination =
  | { kind: "parcel"; code: string }
  | { kind: "label"; code: string }
  | { kind: "unknown" };

export async function actionResolveScannedCode(
  code: string,
): Promise<ScanDestination> {
  await requireStaff();
  const normalised = code.trim().toUpperCase();
  if (!normalised) return { kind: "unknown" };
  try {
    const status = await adminGo<{ code: string; preLabel?: boolean }>(
      `/v1/parcels/${encodeURIComponent(normalised)}/status`,
    );
    // preLabel means the code resolved against parcel_label_stock
    // rather than a real booking — a blank or filled-in label, whose
    // useful destination is the attach form, not the parcels ledger.
    return { kind: status.preLabel ? "label" : "parcel", code: status.code };
  } catch {
    return { kind: "unknown" };
  }
}

// The read half. An edit form MUST call this before it saves: the
// POST below overwrites rather than merges, so a form that opens
// blank and re-submits every field erases whatever it didn't load.
//
// Three outcomes worth keeping distinct at the call site — `info: null`
// is a real but still-blank label (the ordinary first-attach case, not
// an error), while a thrown error is a code that isn't stock at all or
// is already bound to a booking.
export async function actionGetParcelLabelInfo(
  code: string,
): Promise<
  { ok: true; info: ParcelLabelInfoInput | null } | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const { info } = await adminGo<{ info: ParcelLabelInfoInput | null }>(
      `/v1/admin/parcels/labels/info/${encodeURIComponent(code)}`,
    );
    return { ok: true, info: info ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not load that label",
    };
  }
}

export async function actionAttachParcelLabelInfo(
  code: string,
  info: ParcelLabelInfoInput,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/labels/info/${encodeURIComponent(code)}`, {
      method: "POST",
      body: JSON.stringify(info),
    });
    revalidatePath("/parcels/labels");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not attach that info",
    };
  }
}

// ── Courier teams ──
// A dispatch-planning layer on top of the individual-courier role
// above: a team (manager + roster) owns one or more fleets (a
// physical vehicle, its own fleet number), each fleet running trips —
// a batch of parcels handed to it, from dispatch until a staffer
// marks it back. See dbx's parcel_teams.go for the full rationale.

export interface CourierTeamRow {
  ID: string;
  Name: string;
  ManagerName: string | null;
  MemberCount: number;
  FleetCount: number;
  CreatedAt: string;
}

export interface CourierTeamMemberRow {
  PartyID: string;
  Name: string;
  Msisdn: string | null;
  Role: string;
  AddedAt: string;
}
export interface CourierFleetRow {
  ID: string;
  FleetNumber: string;
  VehicleType: string;
  OpenTripID: string | null;
  AssignedOpen: number;
}

export async function actionListCourierTeams(): Promise<CourierTeamRow[]> {
  await requireStaff();
  const { teams } = await adminGo<{ teams: CourierTeamRow[] | null }>(
    "/v1/admin/parcels/courier-teams",
  );
  return teams ?? [];
}

export async function actionGetCourierTeam(teamId: string): Promise<{
  name: string;
  members: CourierTeamMemberRow[];
  fleets: CourierFleetRow[];
} | null> {
  try {
    await requireStaff();
    const res = await adminGo<{
      name: string;
      members: CourierTeamMemberRow[] | null;
      fleets: CourierFleetRow[] | null;
    }>(`/v1/admin/parcels/courier-teams/${teamId}`);
    return {
      name: res.name,
      members: res.members ?? [],
      fleets: res.fleets ?? [],
    };
  } catch {
    return null;
  }
}

export async function actionCreateCourierTeam(input: {
  name: string;
  manager: { name: string; msisdn: string; role?: string };
}): Promise<{ ok: true; teamId: string } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { teamId } = await adminGo<{ teamId: string }>(
      "/v1/admin/parcels/courier-teams",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    revalidatePath("/parcels/teams");
    return { ok: true, teamId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create that team",
    };
  }
}

export async function actionAddTeamRosterMember(
  teamId: string,
  input: { name: string; msisdn: string; role?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/courier-teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath(`/parcels/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not add that member",
    };
  }
}

export async function actionRenameCourierTeam(
  teamId: string,
  name: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/courier-teams/${teamId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    revalidatePath(`/parcels/teams/${teamId}`);
    revalidatePath("/parcels/teams");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not rename that team",
    };
  }
}

// Corrects a roster entry — texts the member on their (possibly new)
// number the moment it's saved, same as adding them does; see
// notify.CourierTeamMemberUpdated.
export async function actionUpdateTeamRosterMember(
  teamId: string,
  partyId: string,
  input: { name: string; msisdn: string; role?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(
      `/v1/admin/parcels/courier-teams/${teamId}/members/${partyId}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    revalidatePath(`/parcels/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that member",
    };
  }
}

export async function actionAddCourierFleet(
  teamId: string,
  input: { fleetNumber: string; vehicleType: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/courier-teams/${teamId}/fleets`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath(`/parcels/teams/${teamId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not add that fleet",
    };
  }
}

export async function actionAssignParcelsToFleet(
  fleetId: string,
  codes: string[],
): Promise<{ ok: true; assigned: string[] } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { assigned } = await adminGo<{ assigned: string[] | null }>(
      `/v1/admin/parcels/fleets/${fleetId}/assign`,
      {
        method: "POST",
        body: JSON.stringify({ codes }),
      },
    );
    revalidatePath("/parcels/teams", "layout");
    return { ok: true, assigned: assigned ?? [] };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not assign those parcels",
    };
  }
}

export async function actionCompleteCourierTrip(
  tripId: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/trips/${tripId}/complete`, {
      method: "POST",
    });
    revalidatePath("/parcels/teams", "layout");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not complete that trip",
    };
  }
}

/** A handler scanning one already-assigned parcel onto the vehicle —
 *  the confirmation dbx.AssignParcelsToFleet's own bulk write never
 *  gave, and exactly what dbx.CheckTripDispatched reads to tell a
 *  boarded parcel apart from a left-behind one. */
export async function actionBoardParcelOntoTrip(
  tripId: string,
  code: string,
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/trips/${tripId}/board`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    revalidatePath("/parcels/teams", "layout");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not board that parcel",
    };
  }
}

export interface LeftBehindParcelRow {
  code: string;
  destinationLabel: string;
}

/** The explicit "I'm done scanning" moment — see this endpoint's own
 *  handler comment on why exactly one SMS fires from this call, never
 *  a text per parcel. */
export async function actionCheckTripDispatched(
  tripId: string,
): Promise<
  | { ok: true; boardedCount: number; leftBehind: LeftBehindParcelRow[] }
  | { ok: false; error: string }
> {
  try {
    await requireStaff();
    const res = await adminGo<{
      boardedCount: number;
      leftBehind: LeftBehindParcelRow[] | null;
    }>(`/v1/admin/parcels/trips/${tripId}/checked`, { method: "POST" });
    revalidatePath("/parcels/teams", "layout");
    return {
      ok: true,
      boardedCount: res.boardedCount,
      leftBehind: res.leftBehind ?? [],
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Could not check this trip as dispatched",
    };
  }
}

// ── Live dispatch ──

export interface LiveCourierPosition {
  CourierPartyID: string;
  Name: string;
  VehicleType: string;
  Lat: string;
  Lng: string;
  At: string;
}
export interface LiveUnassignedParcel {
  Code: string;
  Status: string;
  Lat: string | null;
  Lng: string | null;
  Overdue: boolean;
}

export async function actionGetLiveDispatch(): Promise<{
  couriers: LiveCourierPosition[];
  parcels: LiveUnassignedParcel[];
}> {
  await requireStaff();
  const res = await adminGo<{
    couriers: LiveCourierPosition[] | null;
    parcels: LiveUnassignedParcel[] | null;
  }>("/v1/admin/parcels/live");
  return { couriers: res.couriers ?? [], parcels: res.parcels ?? [] };
}
