'use server';

import { revalidatePath } from 'next/cache';
import { updateParcelPricingRule, type UpdateParcelPricingRuleInput } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { adminGo } from '@/lib/go-ticketing';

export type Result = { ok: true } | { ok: false; error: string };

export async function actionUpdateParcelPricing(
  parcelType: string,
  input: UpdateParcelPricingRuleInput,
): Promise<Result> {
  try {
    const ctx = await requireStaff();
    await updateParcelPricingRule(ctx, parcelType, input);
    revalidatePath('/parcels/pricing');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save that price' };
  }
}

export interface CollectorLite { PartyID: string; Name: string; Msisdn: string | null }

export async function actionSearchCollectors(q: string): Promise<CollectorLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { collectors } = await adminGo<{ collectors: CollectorLite[] | null }>(`/v1/admin/parcels/collectors?q=${encodeURIComponent(q)}`);
  return collectors ?? [];
}

export async function actionAssignParcelCollector(
  parcelId: string,
  input: { collectorPartyId: string; scheduledAt: string; note?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/assign`, { method: 'POST', body: JSON.stringify(input) });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not schedule that collection' };
  }
}

export async function actionCancelParcel(parcelId: string, reason: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not cancel that parcel' };
  }
}

export async function actionMarkParcelRefunded(parcelId: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/refund`, { method: 'POST' });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not mark that refund as processed' };
  }
}

export interface HandoffRow { FromName: string | null; ToName: string; CreatedAt: string }

export async function actionGetParcelHandoffs(parcelId: string): Promise<HandoffRow[]> {
  await requireStaff();
  const { handoffs } = await adminGo<{ handoffs: HandoffRow[] | null }>(`/v1/admin/parcels/${parcelId}/handoffs`);
  return handoffs ?? [];
}

export async function actionUpdateParcelDetails(
  parcelId: string,
  input: { receiverName: string; receiverMsisdn: string; destinationLabel: string; notes?: string },
): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}`, { method: 'PATCH', body: JSON.stringify(input) });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save those details' };
  }
}

export async function actionClearParcelException(parcelId: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/exception/clear`, { method: 'POST' });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not clear that exception' };
  }
}

export async function actionFlagParcelException(parcelId: string, note: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/${parcelId}/exception`, { method: 'POST', body: JSON.stringify({ note }) });
    revalidatePath('/parcels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not flag that parcel' };
  }
}

// ── Couriers ──

export interface ParcelCourierRow {
  ID: string; PartyID: string; Name: string; Msisdn: string | null;
  VehicleType: string; Status: string; VettingNote: string | null;
  ActivatedAt: string | null; SuspendedAt: string | null; CreatedAt: string;
}

export interface CourierPerformance { deliveredCount: number; onTimeCount: number; avgConditionRating: number | null }

export async function actionListCouriers(status?: string, q?: string): Promise<ParcelCourierRow[]> {
  await requireStaff();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const { couriers } = await adminGo<{ couriers: ParcelCourierRow[] | null }>(`/v1/admin/parcels/couriers?${params.toString()}`);
  return couriers ?? [];
}

export async function actionSearchOnboardCandidates(q: string): Promise<CollectorLite[]> {
  await requireStaff();
  if (!q.trim()) return [];
  const { candidates } = await adminGo<{ candidates: CollectorLite[] | null }>(`/v1/admin/parcels/couriers/candidates?q=${encodeURIComponent(q)}`);
  return candidates ?? [];
}

export async function actionOnboardCourier(partyId: string, vehicleType: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo('/v1/admin/parcels/couriers', { method: 'POST', body: JSON.stringify({ partyId, vehicleType }) });
    revalidatePath('/parcels/couriers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not onboard that courier' };
  }
}

export async function actionSetCourierStatus(courierId: string, status: string, note?: string): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/couriers/${courierId}/status`, { method: 'POST', body: JSON.stringify({ status, note }) });
    revalidatePath('/parcels/couriers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update that courier' };
  }
}

// Keyed by partyId in the query string — the Go handler resolves
// performance by joining parcel.currentHolderPartyId directly, not by
// the courier row's own id, so the :id path segment here is a
// placeholder the route needs but the handler doesn't read.
export async function actionGetCourierPerformance(partyId: string): Promise<CourierPerformance> {
  await requireStaff();
  return adminGo<CourierPerformance>(`/v1/admin/parcels/couriers/${partyId}/performance?partyId=${encodeURIComponent(partyId)}`);
}

// ── Zones & distance pricing ──

export interface ParcelZone { id: string; name: string; lat: number; lng: number; active: boolean }

export async function actionListParcelZones(): Promise<ParcelZone[]> {
  await requireStaff();
  const { zones } = await adminGo<{ zones: ParcelZone[] | null }>('/v1/admin/parcels/zones');
  return zones ?? [];
}

export async function actionCreateParcelZone(name: string, lat: number, lng: number): Promise<Result> {
  try {
    await requireStaff();
    await adminGo('/v1/admin/parcels/zones', { method: 'POST', body: JSON.stringify({ name, lat, lng }) });
    revalidatePath('/parcels/pricing');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create that zone' };
  }
}

export async function actionUpdateParcelZone(id: string, name: string, lat: number, lng: number, active: boolean): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/zones/${id}`, { method: 'PATCH', body: JSON.stringify({ name, lat, lng, active }) });
    revalidatePath('/parcels/pricing');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update that zone' };
  }
}

export interface ParcelDistanceRate { perKmKes: number; minChargeableKm: number }

export async function actionGetDistanceRate(): Promise<ParcelDistanceRate | null> {
  await requireStaff();
  const { rate } = await adminGo<{ rate: ParcelDistanceRate | null }>('/v1/admin/parcels/distance-rate');
  return rate;
}

export async function actionSetDistanceRate(perKmKes: number, minChargeableKm: number): Promise<Result> {
  try {
    await requireStaff();
    await adminGo('/v1/admin/parcels/distance-rate', { method: 'POST', body: JSON.stringify({ perKmKes, minChargeableKm }) });
    revalidatePath('/parcels/pricing');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the distance rate' };
  }
}

// ── Live dispatch ──

export interface LiveCourierPosition { CourierPartyID: string; Name: string; VehicleType: string; Lat: string; Lng: string; At: string }
export interface LiveUnassignedParcel { Code: string; Status: string; Lat: string | null; Lng: string | null; Overdue: boolean }

export async function actionGetLiveDispatch(): Promise<{ couriers: LiveCourierPosition[]; parcels: LiveUnassignedParcel[] }> {
  await requireStaff();
  const res = await adminGo<{ couriers: LiveCourierPosition[] | null; parcels: LiveUnassignedParcel[] | null }>('/v1/admin/parcels/live');
  return { couriers: res.couriers ?? [], parcels: res.parcels ?? [] };
}
