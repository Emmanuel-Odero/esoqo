'use server';

import { revalidatePath } from 'next/cache';
import {
  setTicketOrgStatus, createTicketOrgStaff, setTicketOrgStaffActive,
  createVenue, createRoute, createListing, publishListing, createTicketClass, createSchedule,
  cancelBooking,
} from '@esoko/db';
import { hashPin } from '@esoko/auth';
import { toSafeErrorMessage } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionModerateOrg(orgId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setTicketOrgStatus(ctx, orgId, status);
    revalidatePath('/ticketing');
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That organiser's status didn't change. Please try again.") };
  }
}

/** Adds an org staff member (ticket seller, gate scanner, manager) on
 *  the organiser's behalf — for onboarding when the owner isn't ready
 *  to self-serve at /org/[orgId]/staff. The PIN is set here, by the
 *  person doing the onboarding, and should be handed over in person or
 *  by phone, never SMS/email. */
export async function actionAddOrgStaff(
  orgId: string, input: { name: string; pin: string; role: 'ADMIN' | 'MANAGER' | 'SCANNER' },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    const pinHash = await hashPin(input.pin);
    await createTicketOrgStaff(ctx, orgId, { name: input.name, pinHash, role: input.role });
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That staff member wasn't added. Please try again.") };
  }
}

export async function actionSetOrgStaffActive(orgId: string, staffId: string, active: boolean): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await setTicketOrgStaffActive(ctx, staffId, active);
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That didn't save. Please try again.") };
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
    const ctx = await requireStaff();
    if (!input.name.trim()) return { ok: false, error: 'Give the venue a name.' };
    await createVenue(ctx, orgId, input);
    revalidatePath(`/ticketing/${orgId}/routes`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That venue wasn't added. Please try again.") };
  }
}

export async function actionCreateRoute(
  orgId: string, input: { originName: string; destinationName: string; distanceKm?: number },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    if (!input.originName.trim() || !input.destinationName.trim()) {
      return { ok: false, error: 'Give the route an origin and a destination.' };
    }
    await createRoute(ctx, orgId, input);
    revalidatePath(`/ticketing/${orgId}/routes`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That route wasn't added. Please try again.") };
  }
}

export async function actionCreateListing(
  orgId: string,
  input: { title: string; description?: string; venueId?: string; routeId?: string },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await createListing(ctx, orgId, input);
    revalidatePath(`/ticketing/${orgId}/listings`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That listing wasn't created. Please try again.") };
  }
}

export async function actionPublishListing(
  orgId: string, listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED',
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await publishListing(ctx, listingId, status);
    revalidatePath(`/ticketing/${orgId}/listings`);
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That listing's status didn't change. Please try again.") };
  }
}

export async function actionCreateTicketClass(
  orgId: string, listingId: string,
  input: { name: string; priceKes: number; capacity: number; seated?: boolean },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await createTicketClass(ctx, listingId, input);
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That ticket class wasn't added. Please try again.") };
  }
}

export async function actionCreateSchedule(
  orgId: string, listingId: string,
  input: { departAt: string; arriveAt?: string; gateInfo?: string; vehicleOrHallLabel?: string },
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    const departAt = new Date(input.departAt);
    if (Number.isNaN(departAt.getTime())) return { ok: false, error: 'Give a valid date and time.' };
    await createSchedule(ctx, listingId, {
      departAt,
      arriveAt: input.arriveAt ? new Date(input.arriveAt) : undefined,
      gateInfo: input.gateInfo,
      vehicleOrHallLabel: input.vehicleOrHallLabel,
    });
    revalidatePath(`/ticketing/${orgId}/listings/${listingId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That occurrence wasn't scheduled. Please try again.") };
  }
}

// ───────────────────────────── Bookings ────────────────────────────

/** Staff-initiated cancel — the ticketing counterpart to actionModerateOrg:
 *  an oversight action on someone else's booking (chargeback, buyer
 *  called support, duplicate checkout), not the buyer cancelling their
 *  own. Goes through the same cancelBooking as the org's own console. */
export async function actionCancelBooking(orgId: string, bookingId: string): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await cancelBooking(ctx, bookingId);
    revalidatePath(`/ticketing/${orgId}/bookings`);
    revalidatePath(`/ticketing/${orgId}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: toSafeErrorMessage(e, "That booking wasn't cancelled. Please try again.") };
  }
}
