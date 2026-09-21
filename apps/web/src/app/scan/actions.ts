'use server';

// The universal scanner's one server call.
//
// Same convention as apps/web/parcels/actions.ts: CORE_GO_API_URL is an
// internal service address in every deployed environment, so a browser
// cannot reach core-go directly and every call goes through a server
// action. No auth header anywhere in this file — resolving a code is
// deliberately guest-safe, which is the whole premise of a scanner
// somebody points at a label in a shop.
const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

/**
 * Every kind core-go's resolver can return (see dbx.ResolveScan). The
 * web app handles a subset and says so honestly for the rest, rather
 * than narrowing the type and silently mis-rendering a kind the server
 * grew later.
 */
export type ScanKind =
  | 'trip' | 'voucher' | 'fare' | 'product' | 'store' | 'table'
  | 'ticket' | 'order' | 'party' | 'certificate' | 'parcel' | 'luggage' | 'unknown';

/** The action hint core-go attaches to each kind — pay | menu |
 *  checkout | pickup | verify | open | info | track. Carried through
 *  even where this app doesn't branch on it, because the server owning
 *  that decision is the point of having it. */
export type ScanAction = string;

export interface ScanResolution {
  kind: ScanKind;
  action: ScanAction;
  parcel?: { code: string; status: string; originLabel: string; destinationLabel: string };
  ticket?: {
    ticketId: string; code: string; status: string; className: string;
    seatLabel?: string | null; priceKes: string; eventName: string; orgName: string;
  };
  order?: {
    orderId: string; pickupCode: string; status: string;
    storeName: string; totalKes: string; readyAt?: string | null;
  };
  party?: { esoqoId: string; displayName: string; verified: boolean; organisation: boolean };
  fare?: {
    status: string; fareRef: string; amountKes: string; ageMinutes: number;
    vehiclePlate?: string | null; routeName?: string | null; orgName: string;
  };
  certificate?: {
    found: boolean; status: string; claimType: string;
    holder: string; issuer: string; issuedOn: string; validUntil?: string | null;
  };
  store?: { slug: string; name: string };
  table?: { storeSlug: string; storeName: string; tableLabel: string };
  product?: {
    productId: string; variantId?: string | null; name: string;
    priceKes: string; storeSlug: string; storeName: string;
  };
  voucher?: { shortCode: string; label: string; purpose: string; status: string };
  luggage?: {
    code: string; passengerInitial: string; pieceNo: number;
    pieceCount: number; destinationLabel: string; status: string;
  };
}

/**
 * Resolve one scanned or typed code.
 *
 * Returns kind 'unknown' rather than throwing on anything that fails —
 * a scanner pointed at a supermarket loyalty card is the ordinary case,
 * not an error, and the page renders "not an Esoqo code" identically
 * whether the resolver said so or the request never landed.
 */
export async function actionResolveScan(code: string): Promise<ScanResolution> {
  const trimmed = code.trim();
  if (!trimmed) return { kind: 'unknown', action: 'info' };
  try {
    const res = await fetch(
      `${CORE_GO_URL}/v1/scan/resolve?code=${encodeURIComponent(trimmed)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return { kind: 'unknown', action: 'info' };
    const json = (await res.json().catch(() => null)) as ScanResolution | null;
    return json ?? { kind: 'unknown', action: 'info' };
  } catch {
    return { kind: 'unknown', action: 'info' };
  }
}
