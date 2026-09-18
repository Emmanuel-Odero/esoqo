import { cookies } from "next/headers";
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
 * Calls core-go with the portal's bearer attached.
 *
 * A 401 or 403 becomes ParcelOrgUnauthorised rather than a generic
 * error: both mean the same thing to this portal (this login can't do
 * that), and the caller decides whether to redirect or explain.
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
  if (res.status === 401 || res.status === 403)
    throw new ParcelOrgUnauthorised();
  if (!res.ok || !json) {
    throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
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
}

export interface ParcelOrgMe {
  org: ParcelOrgSummary;
  stats: ParcelOrgStats;
  capabilities: string[];
}

export async function getParcelOrgMe(): Promise<ParcelOrgMe> {
  return parcelOrgFetch<ParcelOrgMe>("/v1/parcel-orgs/me");
}

/** Live dispatch — rider dots, parcels needing a rider or running late,
 *  and the company's stations. Mirrors core-go's dbx.OrgLiveView. */
export interface OrgLiveRider {
  partyId: string;
  name: string;
  role: string;
  lat: string;
  lng: string;
  at: string;
}

export interface OrgLiveParcel {
  code: string;
  status: string;
  lat: string | null;
  lng: string | null;
  overdue: boolean;
  receiverName: string;
}

export interface OrgLiveView {
  riders: OrgLiveRider[];
  parcels: OrgLiveParcel[];
  stations: ParcelOrgStationRow[];
}

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
  /** The phone and the ESK-… handle this member signs in with — read
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

/** One run of one of the company's own vehicles. Mirrors dbx.Dispatch:
 *  the board's fleet unit — plate, crew, origin → destination leg,
 *  receiving team, live position and trail. */
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
}
