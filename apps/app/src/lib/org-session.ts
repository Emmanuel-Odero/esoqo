/**
 * Generic org session handling for all org types.
 *
 * This module provides unified session management for all organization types
 * (courier, hotel, ticket, eatery, chama, tout). It replaces the courier-specific
 * parcel-org-session.ts for new org types while maintaining backward compatibility
 * with existing courier sessions.
 */

import { cookies } from 'next/headers';
import { cache } from 'react';
import { goUrl } from './ticketing';

/**
 * Get the session cookie name for an org type.
 * Courier uses a legacy cookie name for backward compatibility.
 * Other org types use a generic "org_session" cookie.
 */
export function getOrgSessionCookieName(orgType: string): string {
  if (orgType === 'courier') {
    return 'esoqo_parcel_org_session';
  }
  return 'esoqo_org_session';
}

// 12 hours — a shift, matching the TTL core-go mints the session with.
const ORG_SESSION_TTL = 60 * 60 * 12;

/**
 * Set an org session cookie for the given org type.
 */
export async function setOrgSession(orgType: string, token: string): Promise<void> {
  const jar = await cookies();
  const cookieName = getOrgSessionCookieName(orgType);
  jar.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ORG_SESSION_TTL,
    path: '/',
  });
}

/**
 * Clear an org session cookie for the given org type.
 */
export async function clearOrgSession(orgType: string): Promise<void> {
  const jar = await cookies();
  const cookieName = getOrgSessionCookieName(orgType);
  jar.delete(cookieName);
}

/**
 * Get the org session token for the given org type.
 */
export async function getOrgSessionToken(orgType: string): Promise<string | null> {
  const jar = await cookies();
  const cookieName = getOrgSessionCookieName(orgType);
  return jar.get(cookieName)?.value ?? null;
}

/**
 * Distinguishes "you aren't signed in" from "that failed".
 */
export class OrgSessionUnauthorised extends Error {
  constructor(orgType: string) {
    super(`Not signed in to ${orgType} organization`);
    this.name = 'OrgSessionUnauthorised';
  }
}

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * A core-go rejection that kept its error code.
 */
export class OrgRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OrgRequestError';
    this.code = code;
  }
}

/**
 * Error codes that indicate the session is no good.
 */
const SESSION_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'SESSION_LOOKUP_FAILED',
  'DENIED',
]);

/**
 * Generic org fetch function that attaches the org session token.
 */
export async function orgFetch<T>(
  orgType: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getOrgSessionToken(orgType);
  if (!token) throw new OrgSessionUnauthorised(orgType);

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

  if (res.status === 401 || res.status === 403) {
    const code = json?.error?.code ?? '';
    if (!code || SESSION_ERROR_CODES.has(code)) {
      throw new OrgSessionUnauthorised(orgType);
    }
    throw new OrgRequestError(
      code,
      json?.error?.message ?? `Request failed (${res.status})`,
    );
  }

  if (!res.ok || !json) {
    throw new OrgRequestError(
      json?.error?.code ?? `HTTP_${res.status}`,
      json?.error?.message ?? `Request failed (${res.status})`,
    );
  }

  return json as T;
}

/**
 * Generic org "me" response for any org type.
 * Contains the minimum required fields for portal rendering.
 */
export interface OrgMe {
  org: {
    id: string;
    name: string;
    slug: string;
    status: string;
    logoUrl?: string | null;
    brandAccent?: string | null;
  };
  capabilities: string[];
  [key: string]: any; // Allow org-type-specific fields
}

/**
 * Fetch the current org session data.
 * This caches the result so multiple calls within the same request
 * only make one API call.
 */
export const fetchOrgMe = cache(async (orgId: string, orgType: string): Promise<OrgMe> => {
  return orgFetch<OrgMe>(orgType, `/v1/orgs/${orgId}/me`);
});

/**
 * Fetch org-type-specific metadata.
 * For courier, this includes stats like awaitingDropoff.
 * For ticket, this includes vertical (TRANSPORT or EVENT).
 * For hotel, this might include current bookings or occupancy.
 */
export async function fetchOrgMetadata(
  orgId: string,
  orgType: string,
): Promise<Record<string, any>> {
  try {
    // For now, this returns empty metadata. Each org type can implement
    // its own metadata fetcher in the portal handler's fetchMetadata function.
    return {};
  } catch (error) {
    console.error(`Failed to fetch metadata for ${orgType}/${orgId}:`, error);
    return {};
  }
}

/**
 * Backward compatibility wrapper for parcel org sessions.
 * Callers using the old parcel-org-session.ts API can use these.
 */
export async function setParcelOrgSession(token: string): Promise<void> {
  return setOrgSession('courier', token);
}

export async function clearParcelOrgSession(): Promise<void> {
  return clearOrgSession('courier');
}

export async function parcelOrgToken(): Promise<string | null> {
  return getOrgSessionToken('courier');
}

export class ParcelOrgUnauthorised extends OrgSessionUnauthorised {
  constructor() {
    super('courier');
    this.name = 'ParcelOrgUnauthorised';
  }
}

export class ParcelOrgRequestError extends OrgRequestError {}

export async function parcelOrgFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return orgFetch<T>('courier', path, init);
}

/**
 * Backward compatibility for fetching parcel org session.
 */
export const getParcelOrgMe = cache(async (): Promise<OrgMe> => {
  return parcelOrgFetch<OrgMe>('/v1/parcel-orgs/me');
});
