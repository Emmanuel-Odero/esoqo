import 'server-only';
import { orgGo } from './ticketing';

/**
 * Fleet reads/writes for the organiser console — everything under
 * core-go's /v1/fleet/orgs/:orgId/* (see services/core-go/internal/
 * dbx/fleet.go). All of it is org-scoped and capability-checked
 * server-side; the console's job is only to ask for what the session
 * can actually see. A MANAGER holds the read bundle (fleet.read,
 * trip.read, crew.read, vehicle.track) but not the write bundle, so the
 * pages below render actions conditionally while the server stays the
 * boundary.
 *
 * Field names mirror core-go's JSON verbatim. A few of the older fleet
 * structs carry no json tags, so their keys are Go field names
 * (PlateNo, VehiclePlate, TripID…); the newer overview/trail structs
 * are tagged camelCase. Do not "tidy" these — they must match the
 * server byte for byte.
 */

export interface FleetOverview {
  activeTrips: number;
  vehiclesOnRoad: number;
  fleetSize: number;
  crewActive: number;
  routesActive: number;
  reportingVehicles: number;
  faresTodayCount: number;
  faresTodayKes: string;
  cashFaresTodayKes: string;
  declaredCashTodayKes: string;
  cashVarianceTodayKes: string;
}

export interface FleetVehicle {
  ID: string;
  PlateNo: string;
  Capacity: number | null;
  Label: string | null;
  Status: string;
}

export interface CrewMember {
  ID: string;
  Name: string;
  Role: string;
  Active: boolean;
}

export interface FareStage {
  ID: string;
  ShortRouteID: string;
  Name: string;
  Order: number;
  FareKES: string;
}

export interface ShortRoute {
  ID: string;
  OrgID: string;
  Name: string;
  Active: boolean;
  Stages: FareStage[] | null;
}

export interface FleetTrip {
  ID: string;
  VehiclePlate: string;
  DriverName: string | null;
  ConductorName: string | null;
  /** Which short route this run is on, when it is on one. Already on the
   *  wire (dbx.Trip.ShortRouteID) — declared here because the luggage
   *  desk needs it to know which drop-point chips to offer. */
  ShortRouteID: string | null;
  Status: string;
  StartedAt: string;
  EndedAt: string | null;
}

export interface VehiclePosition {
  TripID: string;
  VehicleID: string;
  VehiclePlate: string;
  Lat: string;
  Lng: string;
  At: string;
}

export interface TrailPoint {
  lat: string;
  lng: string;
  at: string;
}

export interface ActiveTrail {
  tripId: string;
  vehicleId: string;
  vehiclePlate: string;
  points: TrailPoint[];
}

export async function getFleetOverview(orgId: string): Promise<FleetOverview> {
  const { overview } = await orgGo<{ overview: FleetOverview }>(
    orgId, `/v1/fleet/orgs/${orgId}/overview`,
  );
  return overview;
}

export async function listFleetTrips(orgId: string, activeOnly = false): Promise<FleetTrip[]> {
  const q = activeOnly ? '?active=true' : '';
  const { trips } = await orgGo<{ trips: FleetTrip[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/trips${q}`,
  );
  return trips ?? [];
}

export async function listFleetVehicles(orgId: string): Promise<FleetVehicle[]> {
  const { vehicles } = await orgGo<{ vehicles: FleetVehicle[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/vehicles`,
  );
  return vehicles ?? [];
}

export async function listFleetCrew(orgId: string): Promise<CrewMember[]> {
  const { crew } = await orgGo<{ crew: CrewMember[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/crew`,
  );
  return crew ?? [];
}

export async function listShortRoutes(orgId: string): Promise<ShortRoute[]> {
  const { routes } = await orgGo<{ routes: ShortRoute[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/short-routes`,
  );
  return routes ?? [];
}

export async function latestPositions(orgId: string): Promise<VehiclePosition[]> {
  const { positions } = await orgGo<{ positions: VehiclePosition[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/positions`,
  );
  return positions ?? [];
}

export async function activeTrails(orgId: string, minutes = 60): Promise<ActiveTrail[]> {
  const { trails } = await orgGo<{ trails: ActiveTrail[] | null }>(
    orgId, `/v1/fleet/orgs/${orgId}/trails?minutes=${minutes}`,
  );
  return trails ?? [];
}

export async function startTrip(
  orgId: string,
  input: { vehicleId: string; driverId?: string | null; conductorId?: string | null; shortRouteId?: string | null },
): Promise<void> {
  await orgGo(orgId, '/v1/fleet/trips', {
    method: 'POST',
    body: JSON.stringify({
      orgId,
      vehicleId: input.vehicleId,
      driverId: input.driverId || null,
      conductorId: input.conductorId || null,
      shortRouteId: input.shortRouteId || null,
    }),
  });
}

export async function closeFleetTrip(orgId: string, tripId: string): Promise<void> {
  await orgGo(orgId, `/v1/fleet/trips/${tripId}/close`, { method: 'POST', body: '{}' });
}

export async function createShortRoute(
  orgId: string,
  name: string,
  stages: { name: string; fareKes: number }[],
): Promise<void> {
  await orgGo(orgId, '/v1/fleet/short-routes', {
    method: 'POST',
    body: JSON.stringify({ orgId, name, stages: stages.map((s) => ({ name: s.name, fareKes: s.fareKes })) }),
  });
}
