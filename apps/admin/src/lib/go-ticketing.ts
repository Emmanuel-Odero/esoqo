import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { AuthorisationError } from '@esoqo/db';

/**
 * Admin → core-go client for the ticketing surface. Forwards the staff
 * session cookie as Bearer (same Redis format Go reads; STAFF caps stay
 * session-frozen). Go enforces via RequireCapability; this mapping only
 * preserves the pages' `instanceof AuthorisationError → notFound()`
 * shape with server-generated messages.
 */

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

export async function adminGo<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await fetch(`${CORE_GO_URL}${path}`, {
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
      throw new AuthorisationError(message, { actorType: 'STAFF', actorId: null });
    }
    throw new Error(message);
  }
  return json as T;
}

export interface GoAdminOrg {
  id: string;
  enterpriseId: string;
  enterprisePartyId: string;
  name: string;
  slug: string;
  vertical: string;
  status: string;
  contactPerson?: string | null;
  contactPhone?: string | null;
  staffCount: number;
  listingsCount: number;
  ownerName: string | null;
  createdAt: string;
  enterprise?: { partyId: string };
}

export function adminOrgForCan<T extends { enterprisePartyId: string }>(org: T): T & { enterprise: { partyId: string } } {
  return { ...org, enterprise: { partyId: org.enterprisePartyId } };
}

export interface GoConsoleOrg extends GoAdminOrg {
  contactPerson?: string | null;
  vertical: string;
}

export interface GoConsoleListing {
  id: string;
  title: string;
  slug: string;
  status: string;
  createdAt: string;
  venue: { name: string } | null;
  route: { originName: string; destinationName: string } | null;
  ticketClasses: {
    id: string; name: string; priceKes: string; capacity: number; seated: boolean;
    amenities: string[]; amenityNote: string | null;
  }[];
  schedules: {
    id: string; departAt: string; arriveAt: string | null; gateInfo: string | null;
    vehicleOrHallLabel: string | null; status: string; bookingsCount: number;
  }[];
  addons: { id: string; name: string }[];
}

export interface GoVenueRow {
  id: string; name: string; address: string | null; county: string | null; capacity: number | null;
}

export interface GoRouteRow {
  id: string; originName: string; destinationName: string; distanceKm: number | null;
}

export interface GoStaffRow {
  id: string; name: string; role: string; active: boolean;
}

export interface GoBookingRow {
  id: string;
  listingTitle: string;
  buyerName: string;
  buyerMsisdn: string;
  status: string;
  paymentMethod: string;
  totalKes: string;
  ticketCount: number;
  checkedInCount: number;
  issuedCount: number;
  createdAt: string;
}
