'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';

export type Result = { ok: true } | { ok: false; error: string };

function goError(e: unknown, fallback: string): string {
  console.error(e);
  // Go returns server-generated messages; network failures (no message
  // from Go) fall back to the per-action copy.
  if (e instanceof Error && !e.message.startsWith('Request failed (')) return e.message;
  return fallback;
}

export async function actionModerateOrg(orgId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/ticketorgs/${orgId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    revalidatePath('/ticketing');
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That organiser's status didn't change. Please try again.") };
  }
}

/** Adds an org staff member (ticket seller, gate scanner, manager) on
 *  the organiser's behalf — for onboarding when the owner isn't ready
 *  to self-serve at /org/[orgId]/staff. The raw PIN goes to core-go
 *  (hashed at that boundary); hand it over in person or by phone,
 *  never SMS/email. */
export async function actionAddOrgStaff(
  orgId: string, input: { name: string; pin: string; role: 'ADMIN' | 'MANAGER' | 'SCANNER' },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/ticketorgs/${orgId}/staff`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That staff member wasn't added. Please try again.") };
  }
}

export async function actionSetOrgStaffActive(orgId: string, staffId: string, active: boolean): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/org-staff/${staffId}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That didn't save. Please try again.") };
  }
}

// ─────────────────────── Venues, routes, listings ─────────────────

/** Staff registering a venue on an organiser's behalf — same onboarding
 *  reasoning as actionAddOrgStaff: gets an event/tour org set up before
 *  its own team is self-serving at /org/[orgId]. */
export async function actionCreateVenue(
  orgId: string, input: { name: string; address?: string; county?: string; capacity?: number },
): Promise<Result> {
  try {
    await requireStaff();
    if (!input.name.trim()) return { ok: false, error: 'Give the venue a name.' };
    await adminGo(`/v1/ticketorgs/${orgId}/venues`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/ticketing/${orgId}/routes`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That venue wasn't added. Please try again.") };
  }
}

export async function actionCreateRoute(
  orgId: string, input: { originName: string; destinationName: string; distanceKm?: number },
): Promise<Result> {
  try {
    await requireStaff();
    if (!input.originName.trim() || !input.destinationName.trim()) {
      return { ok: false, error: 'Give the route an origin and a destination.' };
    }
    await adminGo(`/v1/ticketorgs/${orgId}/routes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/ticketing/${orgId}/routes`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That route wasn't added. Please try again.") };
  }
}

export async function actionCreateListing(
  orgId: string,
  input: { title: string; description?: string; venueId?: string; routeId?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/ticketorgs/${orgId}/listings`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/ticketing/${orgId}/listings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That listing wasn't created. Please try again.") };
  }
}

export async function actionPublishListing(
  orgId: string, listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED',
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/org-listings/${listingId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    revalidatePath(`/ticketing/${orgId}/listings`);
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That listing's status didn't change. Please try again.") };
  }
}

export async function actionCreateTicketClass(
  orgId: string, listingId: string,
  input: { name: string; priceKes: number; capacity: number; seated?: boolean },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/org-listings/${listingId}/classes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That ticket class wasn't added. Please try again.") };
  }
}

export async function actionCreateSchedule(
  orgId: string, listingId: string,
  input: { departAt: string; arriveAt?: string; gateInfo?: string; vehicleOrHallLabel?: string },
): Promise<Result> {
  try {
    await requireStaff();
    const departAt = new Date(input.departAt);
    if (Number.isNaN(departAt.getTime())) return { ok: false, error: 'Give a valid date and time.' };
    await adminGo(`/v1/org-listings/${listingId}/schedules`, {
      method: 'POST',
      body: JSON.stringify({
        departAt: departAt.toISOString(),
        arriveAt: input.arriveAt ? new Date(input.arriveAt).toISOString() : null,
        gateInfo: input.gateInfo ?? null,
        vehicleOrHallLabel: input.vehicleOrHallLabel ?? null,
      }),
    });
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That occurrence wasn't scheduled. Please try again.") };
  }
}

// ───────────────────────────── Bookings ────────────────────────────

/** Staff-initiated cancel — the ticketing counterpart to actionModerateOrg:
 *  an oversight action on someone else's booking (chargeback, buyer
 *  called support, duplicate checkout), not the buyer cancelling their
 *  own. Goes through the same cancel path as the org's own console. */
export async function actionCancelBooking(orgId: string, bookingId: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/bookings/${bookingId}/cancel`, { method: 'POST' });
    revalidatePath(`/ticketing/${orgId}/bookings`);
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: goError(e, "That booking wasn't cancelled. Please try again.") };
  }
}
