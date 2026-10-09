'use server';

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';
const UNAVAILABLE = 'The booking service is unreachable. Check your connection and try again.';

interface GoErrorBody {
  error?: { code?: string; message?: string };
}

function goMessage(json: GoErrorBody | null, fallback: string): string {
  return typeof json?.error?.message === 'string' && json.error.message ? json.error.message : fallback;
}

async function goGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CORE_GO_URL}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

async function goPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CORE_GO_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => null)) as (T & GoErrorBody) | null;
  if (!res.ok || !json) throw new Error(goMessage(json, UNAVAILABLE));
  return json as T;
}

export interface TransportCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export async function listTransportCompanies(): Promise<TransportCompany[]> {
  try {
    const { companies } = await goGet<{ companies: TransportCompany[] | null }>('/v1/transport/companies');
    return companies ?? [];
  } catch {
    return [];
  }
}

export interface BusRoute {
  id: string;
  originName: string;
  destinationName: string;
  distanceKm: number | null;
  active: boolean;
}

export async function listCompanyRoutes(orgId: string): Promise<BusRoute[]> {
  try {
    const { routes } = await goGet<{ routes: BusRoute[] | null }>(
      `/v1/transport/companies/${encodeURIComponent(orgId)}/routes`,
    );
    return routes ?? [];
  } catch {
    return [];
  }
}

export interface BusStation {
  id: string;
  name: string;
  locationHint: string;
}

/** One company's own stations — the same register its parcel runs
 *  pick from — for the "where do you board / alight" pickers. Reuses
 *  the parcel side's own public endpoint rather than a bus-only one:
 *  it is the same station list either way. */
export async function listCompanyStations(orgId: string): Promise<BusStation[]> {
  try {
    const { stations } = await goGet<{ stations: BusStation[] | null }>(
      `/v1/parcels/org-stations?orgId=${encodeURIComponent(orgId)}`,
    );
    return stations ?? [];
  } catch {
    return [];
  }
}

/** Every route of this company that visits both stations, in that
 *  order — a Nairobi → Homabay route via Kisii matches a Kisii →
 *  Homabay search too, since the whole trip is still booked end to
 *  end. This is the traveller's actual starting point: pick where you
 *  board and where you alight, not which route it technically is. */
export async function findCompanyRoutes(orgId: string, from: string, to: string): Promise<BusRoute[]> {
  try {
    const qs = new URLSearchParams({ from, to });
    const { routes } = await goGet<{ routes: BusRoute[] | null }>(
      `/v1/transport/companies/${encodeURIComponent(orgId)}/routes/search?${qs.toString()}`,
    );
    return routes ?? [];
  } catch {
    return [];
  }
}

export interface BusTrip {
  id: string;
  busId: string;
  busName: string;
  plateNumber: string;
  seatLayout: string | null;
  routeId: string;
  originName: string;
  destinationName: string;
  departAt: string;
  priceKes: number;
  seatsTotal: number;
  seatsAvailable: number;
  status: string;
}

export async function listRouteTrips(orgId: string, routeId: string): Promise<BusTrip[]> {
  try {
    const qs = new URLSearchParams({ orgId, routeId });
    const { trips } = await goGet<{ trips: BusTrip[] | null }>(`/v1/transport/trips?${qs.toString()}`);
    return trips ?? [];
  } catch {
    return [];
  }
}

/** Every upcoming departure a traveller can board between two
 *  stations, regardless of which of the company's routes happens to
 *  carry it — a Nairobi → Homabay rider shouldn't have to first guess
 *  which route card is theirs. Fetches every matching route's trips
 *  in parallel and merges them into one list sorted by departure, the
 *  same shape a single-route lookup already returns. */
export async function findCompanyTrips(orgId: string, from: string, to: string): Promise<BusTrip[]> {
  const routes = await findCompanyRoutes(orgId, from, to);
  const perRoute = await Promise.all(routes.map((r) => listRouteTrips(orgId, r.id)));
  return perRoute.flat().sort((a, b) => a.departAt.localeCompare(b.departAt));
}

export async function getTrip(tripId: string): Promise<BusTrip | null> {
  try {
    const { trip } = await goGet<{ trip: BusTrip }>(`/v1/transport/trips/${encodeURIComponent(tripId)}`);
    return trip;
  } catch {
    return null;
  }
}

export async function getTripSeats(tripId: string): Promise<{ seatsTotal: number; takenSeats: number[] }> {
  try {
    return await goGet<{ seatsTotal: number; takenSeats: number[] }>(
      `/v1/transport/trips/${encodeURIComponent(tripId)}/seats`,
    );
  } catch {
    return { seatsTotal: 0, takenSeats: [] };
  }
}

interface GoBusBooking {
  bookingId: string;
  code: string;
  totalKes: string;
  status: 'PENDING_PAYMENT' | 'PAID';
  checkoutRequestId?: string;
  paymentError?: string;
}

/** One checkout can cover several seats — a passenger booking for
 *  their family picks more than one, pays once (one STK push for the
 *  combined total), and gets back the one code shared by every seat. */
export async function createBusBooking(input: {
  tripId: string;
  seatNumbers: number[];
  passengerName: string;
  passengerMsisdn: string;
  passengerIdNumber?: string;
}): Promise<
  | { ok: true; bookingId: string; code: string; totalKes: number; status: 'PENDING_PAYMENT' | 'PAID'; warning?: string }
  | { ok: false; error: string }
> {
  if (!input.passengerName.trim()) return { ok: false, error: 'Enter the passenger name' };
  if (!input.passengerMsisdn.trim()) return { ok: false, error: 'Enter a phone number' };
  if (input.seatNumbers.length === 0) return { ok: false, error: 'Choose at least one seat' };
  let json: GoBusBooking;
  try {
    json = await goPost<GoBusBooking>('/v1/transport/bookings', {
      tripId: input.tripId,
      seatNumbers: input.seatNumbers,
      passengerName: input.passengerName,
      passengerMsisdn: input.passengerMsisdn,
      passengerIdNumber: input.passengerIdNumber || null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : UNAVAILABLE };
  }
  if (typeof json.bookingId !== 'string') return { ok: false, error: UNAVAILABLE };
  return {
    ok: true,
    bookingId: json.bookingId,
    code: json.code,
    totalKes: Number(json.totalKes),
    status: json.status,
    warning: json.paymentError ? 'Could not start the M-Pesa payment — try again from your booking page.' : undefined,
  };
}

export interface BusBookingStatus {
  status: string;
  seatNumbers: number[];
  originName: string;
  destinationName: string;
  departAt: string;
  busName: string;
  pricePerSeatKes: number;
  totalKes: number;
  code: string;
  passengerName: string;
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — the booking code is the secret, same convention
 *  the ticketing checkout follows for its own booking id. Every seat
 *  booked in the same checkout shares this code, so the API returns
 *  one row per seat and this collapses them into one status. */
export async function checkBusBookingStatus(code: string): Promise<BusBookingStatus | null> {
  try {
    const { bookings } = await goGet<{ bookings: {
      status: string; seatNumber: number; originName: string; destinationName: string;
      departAt: string; busName: string; priceKes: string; code: string; passengerName: string;
    }[] }>(`/v1/transport/bookings/${encodeURIComponent(code)}`);
    const first = bookings[0];
    if (!first) return null;
    const pricePerSeatKes = Number(first.priceKes);
    return {
      status: first.status,
      seatNumbers: bookings.map((b) => b.seatNumber).sort((a, b) => a - b),
      originName: first.originName,
      destinationName: first.destinationName,
      departAt: first.departAt,
      busName: first.busName,
      pricePerSeatKes,
      totalKes: pricePerSeatKes * bookings.length,
      code: first.code,
      passengerName: first.passengerName,
    };
  } catch {
    return null;
  }
}
