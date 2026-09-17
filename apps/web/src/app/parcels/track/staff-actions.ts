'use server';

import { StaffUnauthorised, clearStaffToken, setStaffToken, staffFetch } from '@/lib/staff-session';

type Result = { ok: true } | { ok: false; error: string };

function toResult(e: unknown): Result {
  if (e instanceof StaffUnauthorised) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'That did not work' };
}

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

/**
 * A code sent to the staffer's own registered phone, not a shared
 * name+PIN — this page is reachable by anyone who finds the URL, which
 * makes a 4-digit PIN a softer target here than it is behind a
 * company's own sign-in link. Always answers the same way whether or
 * not the name/company actually resolve to anything (see
 * handleRequestParcelStaffOtp's own comment) — this endpoint must not
 * become a way to test whether a given name works at a given company.
 */
export async function staffRequestOtp(orgSlug: string, name: string): Promise<Result> {
  try {
    await fetch(`${CORE_GO_URL}/v1/parcel-orgs/staff/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgSlug: orgSlug.trim(), name: name.trim() }),
      cache: 'no-store',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The sign-in service is unreachable' };
  }
}

/** Verifies the code and starts a 10-hour session — shorter than the
 *  12-hour shift the dedicated company portal's PIN sign-in gets,
 *  since this surface is reachable without knowing the company's own
 *  URL. expiresAt (unix millis) comes back so the panel can show a
 *  live countdown rather than a session that just quietly expires. */
export async function staffVerifyOtp(
  orgSlug: string, name: string, code: string,
): Promise<Result & { expiresAt?: number }> {
  try {
    const res = await fetch(`${CORE_GO_URL}/v1/parcel-orgs/staff/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgSlug: orgSlug.trim(), name: name.trim(), code }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.token) {
      return { ok: false, error: json?.error?.message ?? 'Wrong code' };
    }
    await setStaffToken(json.token);
    return { ok: true, expiresAt: json.expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The sign-in service is unreachable' };
  }
}

export async function staffSignOut(): Promise<void> {
  await clearStaffToken();
}

export interface StaffMe {
  org: { name: string; slug: string; status: string };
  capabilities: string[];
  /** unix millis — 0 for a session minted before this field existed. */
  expiresAt: number;
}

export async function getStaffMe(): Promise<StaffMe | null> {
  try {
    const res = await staffFetch<{ org: StaffMe['org']; capabilities: string[]; expiresAt: number }>('/v1/parcel-orgs/me');
    return { org: res.org, capabilities: res.capabilities, expiresAt: res.expiresAt ?? 0 };
  } catch {
    return null;
  }
}

export interface PartyParcelActivityRow {
  code: string; status: string; originLabel: string; destinationLabel: string;
  createdAt: string; role: 'SENT' | 'RECEIVING' | 'HOLDING';
}

export async function getStaffActivity(): Promise<PartyParcelActivityRow[]> {
  try {
    const { parcels } = await staffFetch<{ parcels: PartyParcelActivityRow[] | null }>('/v1/me/parcel-activity');
    return parcels ?? [];
  } catch {
    return [];
  }
}

/** The scan panel's one custody action — covers "check in" (a
 *  self-drop-off's BOOKED->PICKED_UP), "dispatch to the next leg" and
 *  "checked in at a destination hub": all three are, underneath, the
 *  same ScanHandoff call this app's other custody scans already use
 *  (see dbx.ScanHandoff's own comment on why every leg after the first
 *  is just another handoff). The panel labels the button from the
 *  parcel's current status; the server call itself never needed to
 *  know which label was showing. */
export async function staffScanCustody(code: string): Promise<Result> {
  try {
    await staffFetch(`/v1/parcels/${encodeURIComponent(code)}/handoff`, { method: 'POST' });
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** "Checked out" — the receiver has come to collect it. Calls the same
 *  POST /v1/parcels/:code/deliver a courier's own app uses; the caller
 *  must already be the parcel's current holder (see dbx.DeliverParcel),
 *  which is exactly true right after a staffScanCustody at this same
 *  desk. Exactly one of deliveryCode/otpCode is expected to be
 *  meaningful — core-go checks the delivery code first and only falls
 *  back to the OTP result if that's blank (see dbx.DeliverParcel's
 *  own switch), so sending both is harmless. */
export async function staffDeliverParcel(
  code: string, deliveryCode: string, otpCode?: string,
): Promise<Result> {
  try {
    await staffFetch(`/v1/parcels/${encodeURIComponent(code)}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ deliveryCode, otpCode: otpCode ?? '' }),
    });
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/** Texts a one-time code to the receiver's own registered number, as
 *  the alternative to the printed delivery code at hand-over — for a
 *  receiver who lost their code, or when the handler wants a stronger
 *  identity check than "whoever is holding a code". Returns a masked
 *  number for the desk screen to show, never the real one. */
export async function staffRequestDeliveryOtp(
  code: string,
): Promise<{ ok: true; maskedMsisdn: string } | { ok: false; error: string }> {
  try {
    const res = await staffFetch<{ maskedMsisdn: string }>(
      `/v1/parcels/${encodeURIComponent(code)}/deliver/request-otp`, { method: 'POST' },
    );
    return { ok: true, maskedMsisdn: res.maskedMsisdn };
  } catch (e) {
    return toResult(e) as { ok: false; error: string };
  }
}

/** The public, PII-minimal "whose ID is this" lookup — no session
 *  needed, same endpoint the universal scanner already exposes (see
 *  handleResolveScan). Kept separate from the signed-in panel above:
 *  this is a convenience for anyone reading the page, not an
 *  authorization mechanism. */
export async function lookupEsoqoId(
  code: string,
): Promise<{ esoqoId: string; displayName: string; organisation: string | null } | null> {
  try {
    const res = await fetch(`${CORE_GO_URL}/v1/scan/resolve?code=${encodeURIComponent(code.trim())}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.party ?? null;
  } catch {
    return null;
  }
}
