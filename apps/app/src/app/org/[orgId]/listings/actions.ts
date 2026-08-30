'use server';
import { revalidatePath } from 'next/cache';
import {
  createListing, createVenue, createRoute, createTicketClass, createSchedule, publishListing, saveSeatMap,
} from '@esoko/db';
import {
  createListingSchema, createVenueSchema, createRouteSchema,
  createTicketClassSchema, createScheduleSchema, saveSeatMapSchema, toSafeErrorMessage,
} from '@esoko/domain';
import { requireOrgAccess } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again.";

export async function actionCreateListing(orgId: string, raw: unknown) {
  const parsed = createListingSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    const listing = await createListing(ctx, orgId, parsed.data);
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { listingId: listing.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateVenue(orgId: string, raw: unknown) {
  const parsed = createVenueSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    const venue = await createVenue(ctx, orgId, parsed.data);
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { venueId: venue.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateRoute(orgId: string, raw: unknown) {
  const parsed = createRouteSchema.safeParse({ ...(raw as object), orgId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    const route = await createRoute(ctx, orgId, parsed.data);
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const, data: { routeId: route.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateTicketClass(orgId: string, listingId: string, raw: unknown) {
  const parsed = createTicketClassSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    await createTicketClass(ctx, listingId, parsed.data);
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionCreateSchedule(orgId: string, listingId: string, raw: unknown) {
  const parsed = createScheduleSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    await createSchedule(ctx, listingId, parsed.data);
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionSaveSeatMap(orgId: string, listingId: string, raw: unknown) {
  const parsed = saveSeatMapSchema.safeParse({ ...(raw as object), listingId });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const { ctx } = await requireOrgAccess(orgId);
    await saveSeatMap(ctx, listingId, parsed.data);
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}

export async function actionPublishListing(
  orgId: string, listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED',
) {
  try {
    const { ctx } = await requireOrgAccess(orgId);
    await publishListing(ctx, listingId, status);
    revalidatePath(`/org/${orgId}/listings/${listingId}`);
    revalidatePath(`/org/${orgId}/listings`);
    return { ok: true as const };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
