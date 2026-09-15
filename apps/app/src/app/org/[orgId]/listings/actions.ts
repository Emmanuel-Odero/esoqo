'use server';
import { revalidatePath } from 'next/cache';
import {
  createListingSchema, createVenueSchema, createRouteSchema,
  createTicketClassSchema, createScheduleSchema, saveSeatMapSchema,
} from '@esoqo/domain';
import { requireOrgAccess } from '@/lib/session';
import { orgGo } from '@/lib/ticketing';

const FALLBACK = "That didn't go through. Please try again.";

function goError(e: unknown): string {
  console.error(e);
  return e instanceof Error ? e.message : FALLBACK;
}

export async function actionCreateListing(orgId: string, raw: unknown) {
  const parsed = createListingSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    const res = await orgGo<{ listing: { id: string } }>(orgId, `/v1/ticketorgs/${orgId}/listings`, {
      method: 'POST',
      body: JSON.stringify({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        coverImageUrl: parsed.data.coverImageUrl ?? null,
        venueId: parsed.data.venueId ?? null,
        routeId: parsed.data.routeId ?? null,
      }),
    });
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { listingId: res.listing.id } };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionCreateVenue(orgId: string, raw: unknown) {
  const parsed = createVenueSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    const res = await orgGo<{ venue: { id: string } }>(orgId, `/v1/ticketorgs/${orgId}/venues`, {
      method: 'POST',
      body: JSON.stringify({
        name: parsed.data.name,
        address: parsed.data.address ?? null,
        county: parsed.data.county ?? null,
        capacity: parsed.data.capacity ?? null,
      }),
    });
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { venueId: res.venue.id } };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionCreateRoute(orgId: string, raw: unknown) {
  const parsed = createRouteSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    const res = await orgGo<{ route: { id: string } }>(orgId, `/v1/ticketorgs/${orgId}/routes`, {
      method: 'POST',
      body: JSON.stringify({
        originName: parsed.data.originName,
        destinationName: parsed.data.destinationName,
        distanceKm: parsed.data.distanceKm ?? null,
      }),
    });
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { routeId: res.route.id } };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionCreateTicketClass(orgId: string, listingId: string, raw: unknown) {
  const parsed = createTicketClassSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    await orgGo(orgId, `/v1/org-listings/${listingId}/classes`, {
      method: 'POST',
      body: JSON.stringify({
        name: parsed.data.name,
        priceKes: parsed.data.priceKes,
        capacity: parsed.data.capacity,
        seated: parsed.data.seated ?? false,
        amenities: parsed.data.amenities ?? [],
        amenityNote: parsed.data.amenityNote ?? null,
      }),
    });
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionCreateSchedule(orgId: string, listingId: string, raw: unknown) {
  const parsed = createScheduleSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    await orgGo(orgId, `/v1/org-listings/${listingId}/schedules`, {
      method: 'POST',
      body: JSON.stringify({
        departAt: parsed.data.departAt.toISOString(),
        arriveAt: parsed.data.arriveAt?.toISOString() ?? null,
        gateInfo: parsed.data.gateInfo ?? null,
        vehicleOrHallLabel: parsed.data.vehicleOrHallLabel ?? null,
      }),
    });
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionSaveSeatMap(orgId: string, listingId: string, raw: unknown) {
  const parsed = saveSeatMapSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    await requireOrgAccess(orgId);
    await orgGo(orgId, `/v1/org-listings/${listingId}/seatmap`, {
      method: 'PUT',
      body: JSON.stringify({
        rows: parsed.data.rows,
        pattern: parsed.data.pattern,
        seats: parsed.data.seats,
      }),
    });
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}

export async function actionPublishListing(
  orgId: string, listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED',
) {
  try {
    await requireOrgAccess(orgId);
    await orgGo(orgId, `/v1/org-listings/${listingId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: goError(e) };
  }
}
