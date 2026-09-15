import { cookies } from 'next/headers';
import { goUrl } from './ticketing';

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

export const PARCEL_ORG_SESSION_COOKIE = 'esoqo_parcel_org_session';

// 12 hours — a shift, matching the TTL core-go mints the session with.
// A longer cookie than the session behind it would only produce a
// browser that thinks it's signed in and a server that disagrees.
const PARCEL_ORG_SESSION_TTL = 60 * 60 * 12;

export async function setParcelOrgSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(PARCEL_ORG_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: PARCEL_ORG_SESSION_TTL,
    path: '/',
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
    super('Not signed in to a courier company');
    this.name = 'ParcelOrgUnauthorised';
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
export async function parcelOrgFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await parcelOrgToken();
  if (!token) throw new ParcelOrgUnauthorised();

  const res = await fetch(goUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (res.status === 401 || res.status === 403) throw new ParcelOrgUnauthorised();
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
}

export interface ParcelOrgMe {
  org: ParcelOrgSummary;
  stats: ParcelOrgStats;
  capabilities: string[];
}

export async function getParcelOrgMe(): Promise<ParcelOrgMe> {
  return parcelOrgFetch<ParcelOrgMe>('/v1/parcel-orgs/me');
}

export interface ParcelOrgStaffRow {
  id: string;
  orgId: string;
  name: string;
  role: string;
  active: boolean;
  partyId: string | null;
}
