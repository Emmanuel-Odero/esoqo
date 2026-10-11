'use server';

/**
 * Parking finder — UI first, data later.
 *
 * The search box, the "near me" button and the results grid are built
 * and wired; the backend that says which car parks exist is not here
 * yet. When it lands this action will read active ParkingLot rows and
 * rank them by the query string or by distance from the coordinates the
 * browser sends. Until then every search reaches the EMPTY branch and
 * the page shows its "no car parks here yet" state, so nothing
 * downstream has to change when the query is written.
 */

export interface ParkingSpot {
  code: string;
  name: string;
  county: string | null;
  address: string | null;
  ratePerHourKes: number;
  graceMinutes: number;
}

export type ParkingSearchResult =
  | { status: 'RESULTS'; lots: ParkingSpot[] }
  | { status: 'EMPTY' };

export async function searchParking(input: {
  query?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<ParkingSearchResult> {
  // Backend pending: this will query the parking lots and rank them by
  // query/country/address or by straight-line distance from (lat, lng).
  void input;
  return { status: 'EMPTY' };
}