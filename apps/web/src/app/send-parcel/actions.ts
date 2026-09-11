'use server';

// Same convention as apps/web/tickets/[slug]/actions.ts: server-side Go
// calls use the docker/compose service URL, falling back to localhost
// for bare-metal dev. No auth header anywhere in this file — sending a
// parcel from this page is deliberately guest-only, same boundary as
// tickets checkout and apps/store's storefront (see ADR-0003). The
// sender/receiver details on the form ARE the identity core-go needs;
// nothing here ever reads or requires a session cookie.
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

const UNAVAILABLE = 'The parcel service is unreachable. Check your connection and try again.';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

function goMessage(json: GoErrorBody | null, fallback: string): string {
  return typeof json?.error?.message === 'string' && json.error.message ? json.error.message : fallback;
}

async function goFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

export interface BargainReasonView { reason: string; extraDiscountPct: number }
export interface ParcelPricingView {
  parcelType: string; weightLabel: string; minWeightKg: number; maxWeightKg: number;
  minKes: number; maxKes: number; bargainMinPct: number; bargainMaxPct: number;
  bargainReasons: BargainReasonView[]; suggestedTransportMode: string;
}
export interface ParcelZoneView { id: string; name: string; lat: number; lng: number; active: boolean }

/** Every parcel type's price band at once — same one-call shape the
 *  mobile booking form uses to match a typed weight to a bracket
 *  client-side, without a round trip per keystroke. */
export async function actionListParcelPricing(): Promise<ParcelPricingView[]> {
  try {
    const { pricing } = await goFetch<{ pricing: ParcelPricingView[] | null }>('/v1/parcels/pricing');
    return pricing ?? [];
  } catch {
    return [];
  }
}

export async function actionListParcelZones(): Promise<ParcelZoneView[]> {
  try {
    const { zones } = await goFetch<{ zones: ParcelZoneView[] | null }>('/v1/parcels/zones');
    return zones ?? [];
  } catch {
    return [];
  }
}

/** Re-fetches one type's band with the distance surcharge folded in
 *  (when both zones are picked) — the exact quote SetParcelPrice will
 *  independently re-derive and enforce, shown here before payment. */
export async function actionQuoteParcelPrice(
  parcelType: string, originZoneId?: string, destinationZoneId?: string,
): Promise<{ ok: true; data: ParcelPricingView & { distanceKm?: number } } | { ok: false; error: string }> {
  const params = new URLSearchParams({ parcelType });
  if (originZoneId) params.set('originZoneId', originZoneId);
  if (destinationZoneId) params.set('destinationZoneId', destinationZoneId);
  try {
    const data = await goFetch<ParcelPricingView & { distanceKm?: number }>(`/v1/parcels/pricing?${params.toString()}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
}

export interface BookParcelInput {
  senderName: string; senderMsisdn: string;
  receiverName: string; receiverMsisdn: string;
  originLabel: string; destinationLabel: string;
  parcelType: string; weightKg?: number; fragile: boolean; notes?: string;
  originZoneId?: string; destinationZoneId?: string;
}

/** Creates the DRAFT_PENDING_PAYMENT booking. deliveryCode is returned
 *  once, here — a guest sender has no session to revisit later (unlike
 *  the mobile app's "Sent" tab), so this is their only chance to see it
 *  themselves. It also now reaches the receiver automatically by SMS
 *  once a courier picks the parcel up. */
export async function actionBookParcel(
  input: BookParcelInput,
): Promise<{ ok: true; code: string; deliveryCode: string } | { ok: false; error: string }> {
  if (!input.senderName.trim() || !input.senderMsisdn.trim()) return { ok: false, error: 'Enter your name and phone number' };
  if (!input.receiverName.trim() || !input.receiverMsisdn.trim()) return { ok: false, error: "Enter the receiver's name and phone number" };
  if (!input.originLabel.trim() || !input.destinationLabel.trim()) return { ok: false, error: 'Enter where it’s coming from and going to' };
  try {
    const json = await goFetch<{ code: string; deliveryCode: string }>('/v1/parcels', {
      method: 'POST',
      body: JSON.stringify({
        senderName: input.senderName.trim(), senderMsisdn: input.senderMsisdn.trim(),
        receiverName: input.receiverName.trim(), receiverMsisdn: input.receiverMsisdn.trim(),
        originLabel: input.originLabel.trim(), destinationLabel: input.destinationLabel.trim(),
        parcelType: input.parcelType, weightKg: input.weightKg ?? null, fragile: input.fragile,
        notes: input.notes?.trim() || null,
        originZoneId: input.originZoneId ?? null, destinationZoneId: input.destinationZoneId ?? null,
      }),
    });
    return { ok: true, code: json.code, deliveryCode: json.deliveryCode };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
}

export async function actionSetParcelPrice(
  code: string, priceKes: number, bargainReason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await goFetch(`/v1/parcels/${encodeURIComponent(code)}/price`, {
      method: 'POST',
      body: JSON.stringify({ priceKes, bargainReason: bargainReason ?? null }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
}

/** Starts the M-Pesa STK push. In console/sandbox test mode the push
 *  can auto-confirm inline (status comes back BOOKED already); against
 *  real Daraja it stays DRAFT_PENDING_PAYMENT until the webhook lands,
 *  and the form polls actionCheckParcelStatus the same way ticket
 *  checkout does. */
export async function actionPayParcel(
  code: string, msisdn: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  try {
    const json = await goFetch<{ status: string }>(`/v1/parcels/${encodeURIComponent(code)}/pay`, {
      method: 'POST',
      body: JSON.stringify({ paymentMethod: 'MPESA_STK', msisdn: msisdn.trim() }),
    });
    return { ok: true, status: json.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start the M-Pesa payment' };
  }
}

// The structured info a handler attached to a pre-printed label in
// the field — wire type matching Go's dbx.ParcelLabelInfo.
export interface ParcelLabelInfo {
  itemDescription: string;
  destination: string | null;
  ownerName: string | null;
  ownerContact: string | null;
  ownerGender: string | null;
  itemType: string | null;
  weightRangeKg: string | null;
  attachedAt: string;
}

export interface ParcelStatusView {
  code: string; status: string; originLabel: string; destinationLabel: string;
  parcelType: string; priceKes: string | null; createdAt: string; deliveredAt: string | null;
  // preLabel/preLabelInfo — set when `code` is a pre-printed label
  // (see dbx.ParcelLabelStock) scanned/tracked before it was ever
  // attached to a real booking. status reads "LABEL_PRINTED" in that
  // case; preLabelInfo is null until at least an item description has
  // been attached to it (see the admin "Attach info to a label"
  // screen), even for a genuinely pre-printed (but still blank) label.
  preLabel?: boolean;
  preLabelInfo?: ParcelLabelInfo | null;
}

/** Guest-safe — the same code the sender was shown is the bearer
 *  credential for checking on a parcel, same convention a pickup code
 *  follows. Used both for the post-payment poll and for the standalone
 *  "Track a parcel" lookup. */
export async function actionCheckParcelStatus(code: string): Promise<ParcelStatusView | null> {
  try {
    return await goFetch<ParcelStatusView>(`/v1/parcels/${encodeURIComponent(code)}/status`);
  } catch {
    return null;
  }
}
