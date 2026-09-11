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

// ── Label printing ──

// Wire type matching Go's dbx.ParcelLabel (GET /v1/parcels/:code/label)
// — deliberately thin, no phone numbers beyond the last 4 digits, no
// price, no addresses beyond the origin/destination labels. See that
// struct's own comment: a label rides on the outside of the package,
// so it stays PII-minimal the same way the guest-safe tracking view
// does.
export interface ParcelLabel {
  code: string; status: string; parcelType: string; weightKg: number | null;
  originLabel: string; destinationLabel: string;
  receiverName: string; receiverPhoneLast4: string; createdAt: string;
}

export async function actionGetParcelLabel(code: string): Promise<ParcelLabel | null> {
  try {
    await requireStaff();
    return await adminGo<ParcelLabel>(`/v1/parcels/${encodeURIComponent(code)}/label`);
  } catch {
    return null;
  }
}

// ── Pre-printed label stock ──
// A pool of blank PKG-… codes minted ahead of any booking — print a
// batch, stick them on envelopes/boxes in advance, then a booking's
// existingCode binds one to a real shipment the moment it's needed.
// See dbx.ParcelLabelStock's own comment for the full rationale.

export interface ParcelLabelStockRow { code: string; createdAt: string }

export async function actionGenerateParcelLabels(count: number): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const { codes } = await adminGo<{ codes: string[] | null }>('/v1/admin/parcels/labels/generate', {
      method: 'POST', body: JSON.stringify({ count }),
    });
    return { ok: true, codes: codes ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not generate labels' };
  }
}

export async function actionListParcelLabelStock(): Promise<ParcelLabelStockRow[]> {
  await requireStaff();
  const { labels } = await adminGo<{ labels: ParcelLabelStockRow[] | null }>('/v1/admin/parcels/labels?limit=200');
  return labels ?? [];
}

// Structured info attached to a pre-printed label — item, destination,
// owner name/contact/gender, item type, weight range — the moment it's
// actually stuck on a physical item, independent of (and usually well
// before) a real booking. core-go's GET /v1/parcels/:code/status then
// surfaces this same info to anyone who scans/tracks the code, on the
// web track page and the mobile app's scan flow alike (see
// dbx.GetParcelStatus's own comment on the fallback). Every field but
// itemDescription is optional — a handler might only know the item
// and destination at first.
export interface ParcelLabelInfoInput {
  itemDescription: string;
  destination?: string;
  ownerName?: string;
  ownerContact?: string;
  ownerGender?: string;
  itemType?: string;
  weightRangeKg?: string;
}

export async function actionAttachParcelLabelInfo(code: string, info: ParcelLabelInfoInput): Promise<Result> {
  try {
    await requireStaff();
    await adminGo(`/v1/admin/parcels/labels/info/${encodeURIComponent(code)}`, {
      method: 'POST', body: JSON.stringify(info),
    });
    revalidatePath('/parcels/labels');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not attach that info' };
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
