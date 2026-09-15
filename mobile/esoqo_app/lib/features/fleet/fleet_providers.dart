import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'fleet_models.dart';
import 'fleet_repository.dart';

/// GET /v1/me/orgs (authenticated) — ticketing companies the signed-in
/// subject owns. Empty for non-owners (never 403 — see
/// dbx.ListMyTicketOrgs), so the manager section simply hides.
final myOrgsProvider =
    FutureProvider.autoDispose<List<OrgSummary>>(
      (ref) => ref.watch(fleetRepositoryProvider).myOrgs(),
    );

/// GET /v1/fleet/active-trips?orgSlug= (public) — open duty trips a
/// passenger picks from to pay a fare. No crew names, no GPS.
final activeTripsProvider = FutureProvider.autoDispose
    .family<List<ActiveTrip>, String>(
      (ref, orgSlug) => ref.watch(fleetRepositoryProvider).activeTrips(orgSlug),
    );

/// GET /v1/fleet/orgs/:orgId/trips (authenticated, trip.read) — full
/// duty rows with crew names for the manager view.
final orgTripsProvider =
    FutureProvider.autoDispose.family<List<FleetTrip>, String>(
      (ref, orgId) => ref.watch(fleetRepositoryProvider).orgTrips(orgId),
    );

/// GET /v1/fleet/orgs/:orgId/vehicles (authenticated, fleet.read).
final vehiclesProvider = FutureProvider.autoDispose
    .family<List<FleetVehicle>, String>(
      (ref, orgId) => ref.watch(fleetRepositoryProvider).vehicles(orgId),
    );

/// GET /v1/fleet/orgs/:orgId/crew (authenticated, crew.read).
final crewProvider =
    FutureProvider.autoDispose.family<List<CrewMember>, String>(
      (ref, orgId) => ref.watch(fleetRepositoryProvider).crew(orgId),
    );

/// GET /v1/fleet/orgs/:orgId/positions (authenticated, vehicle.track) —
/// latest ping per active vehicle: where each bus is right now.
final positionsProvider = FutureProvider.autoDispose
    .family<List<VehiclePosition>, String>(
      (ref, orgId) => ref.watch(fleetRepositoryProvider).positions(orgId),
    );

/// GET /v1/fleet/trips/:id/collections (authenticated, collection.read)
/// — declared cash vs M-Pesa prompts vs cash fares, with variance.
final collectionsProvider = FutureProvider.autoDispose
    .family<CollectionsSummary, String>(
      (ref, tripId) => ref.watch(fleetRepositoryProvider).collections(tripId),
    );

/// GET /v1/ticketorgs/:id/staff-grants (authenticated,
/// ticketorgstaff.write) — the unified-crew-identity roster (docs/
/// proposals/esoqo-unified-crew-identity.md).
final orgStaffGrantsProvider = FutureProvider.autoDispose
    .family<List<OrgStaffGrant>, String>(
      (ref, orgId) => ref.watch(fleetRepositoryProvider).staffGrants(orgId),
    );
