import { cookies } from 'next/headers';
import { ctxFromToken, SESSION_COOKIE } from '@esoko/auth';
import { AuthorisationError } from '@esoko/db';
import { TICKET_STAFF_SESSION_COOKIE } from './session';

/**
 * Nav- and page-gating for the /org/[orgId] console. UX only — Go
 * (services/core-go, dbx.AssertOwnsOrg) is the enforcement boundary
 * (ADR-0003). `can`/`matches` live here (not imported from @esoko/db)
 * so the only thing this module takes from the DB package is the
 * error class and capability type — no Prisma, no DAL.
 */

export type Capability = string;

interface CtxLike {
  capabilities: Capability[];
  partyId?: string | null;
}

function matches(held: Capability, wanted: Capability, ctx: CtxLike, opts?: Record<string, unknown>): boolean {
  if (held === '*' || held === wanted) return true;
  const [hRes, hRest = ''] = held.split('.');
  const [wRes, wRest = ''] = wanted.split('.');
  if (hRes !== wRes) return false;
  const [hAct, hQual] = hRest.split(':');
  const [wAct, wQual] = wRest.split(':');
  if (hAct !== wAct && hAct !== '*') return false;
  if (!hQual) return true;
  if (hQual === 'own') {
    const target = opts?.partyId ?? opts?.subjectId;
    return Boolean(target) && target === ctx.partyId;
  }
  return hQual === wQual;
}

export function canOrg(
  ctx: CtxLike,
  org: { enterprise: { partyId: string } },
  capability: Capability,
): boolean {
  return ctx.capabilities.some((c) => matches(c, capability, ctx, { partyId: org.enterprise.partyId }));
}

/** Thin Go client — all ticketing reads+writes go to core-go. */
export function goUrl(path: string): string {
  const base = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';
  return `${base}${path}`;
}

export async function goFetch(path: string, token: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(goUrl(path), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`core-go ${res.status} on ${path}`);
  return res.json();
}

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Bearer for console→Go calls. Prefers the org-staff session when it
 * is scoped to this exact org (gate scanners, managers on shared
 * devices), else the owner's subject session. Both are the same Redis
 * token format Go already reads — forwarding is transport, not trust.
 * Returns null when signed out (callers redirect to /signin).
 */
export async function orgBearerToken(orgId: string): Promise<string | null> {
  const jar = await cookies();
  const staffToken = jar.get(TICKET_STAFF_SESSION_COOKIE)?.value;
  if (staffToken) {
    const sctx = await ctxFromToken(staffToken, null).catch(() => null);
    if (sctx?.actorType === 'AGENT' && sctx.ticketOrgId === orgId) return staffToken;
  }
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Authenticated console fetch. Throws AuthorisationError on DENIED/403
 * (pages keep their `catch (e) { if (e instanceof AuthorisationError)
 * notFound(); }` shape) and Error(message) otherwise — Go's messages
 * are server-generated safe strings, same contract as
 * toSafeErrorMessage's DAL branch.
 */
export async function orgGo<T>(orgId: string, path: string, init?: RequestInit): Promise<T> {
  const token = await orgBearerToken(orgId);
  const res = await fetch(goUrl(path), {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) {
    const code = (json as GoErrorBody | null)?.error?.code;
    const message = (json as GoErrorBody | null)?.error?.message ?? `Request failed (${res.status})`;
    if (res.status === 403 || code === 'DENIED') {
      throw new AuthorisationError(message, { actorType: 'SYSTEM', actorId: null });
    }
    throw new Error(message);
  }
  return json as T;
}

// ── Go JSON shapes (Prisma camelCase, datetimes ISO, decimals string)

export interface GoOrg {
  id: string;
  enterpriseId: string;
  enterprisePartyId: string;
  name: string;
  slug: string;
  vertical: 'EVENTS' | 'TRANSPORT';
  status: string;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  loyaltyEnabled: boolean;
  loyaltyPerKes: number;
  installmentsEnabled: boolean;
  minDepositPercent: number;
  createdAt: string;
}

/** Adapts the flat Go org row to the `{ enterprise: { partyId } }`
 *  shape canOrg gates on. */
export function orgForCan(org: GoOrg): GoOrg & { enterprise: { partyId: string } } {
  return { ...org, enterprise: { partyId: org.enterprisePartyId } };
}

export interface GoTicketClass {
  id: string;
  listingId: string;
  name: string;
  priceKes: string;
  seated: boolean;
  capacity: number;
  amenities: string[];
  amenityNote: string | null;
}

export interface GoSchedule {
  id: string;
  listingId: string;
  departAt: string;
  arriveAt: string | null;
  gateInfo: string | null;
  vehicleOrHallLabel: string | null;
  status: string;
  bookingsCount: number;
}

export interface GoListing {
  id: string;
  orgId: string;
  title: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  status: string;
  venueId: string | null;
  routeId: string | null;
  venue: { id: string; name: string } | null;
  route: { id: string; originName: string; destinationName: string } | null;
  ticketClasses: GoTicketClass[];
  schedules: GoSchedule[];
  addons: { id: string; name: string; priceKes: string; active: boolean }[];
}

export interface GoVenue {
  id: string;
  orgId: string;
  name: string;
  address: string | null;
  county: string | null;
  capacity: number | null;
}

export interface GoRoute {
  id: string;
  orgId: string;
  originName: string;
  destinationName: string;
  distanceKm: number | null;
}

export interface GoStaff {
  id: string;
  orgId: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface GoOrgBooking {
  id: string;
  buyerName: string;
  buyerMsisdn: string;
  status: string;
  paymentMethod: string;
  totalKes: string;
  createdAt: string;
  ticketCount: number;
  checkedInCount: number;
  issuedCount: number;
  listingTitle: string;
}

export interface GoSeatMap {
  rows: number;
  pattern: string;
  seats: { label: string; ticketClassId: string }[];
}

export interface GoMyBooking {
  id: string;
  status: string;
  totalKes: string;
  amountPaidKes: string;
  isInstallment: boolean;
  paymentMethod: string;
  balanceDueBy: string | null;
  buyerName: string;
  buyerMsisdn: string;
  listingTitle: string;
  orgName: string;
  vertical: string;
  departAt: string;
  venueName: string | null;
  routeFrom: string | null;
  routeTo: string | null;
  tickets: { id: string; code: string; holderName: string | null; status: string; priceKes: string }[];
  payments: { amountKes: string; kind: string; status: string; confirmedAt: string | null }[];
}
