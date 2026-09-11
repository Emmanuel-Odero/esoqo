import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'fleet_models.dart';

/// Fleet's slice of the Riverpod convention (see ARCHITECTURE.md and
/// `lib/features/shopping/stores_repository.dart`, the exemplar):
/// screens watch thin providers, this class owns every endpoint +
/// mapping. The fare write path mirrors checkout/booking — the screen
/// keeps its `_Stage` machine and STK poll loop, the repository shapes
/// payloads and answers.
final fleetRepositoryProvider = Provider<FleetRepository>((ref) {
  return FleetRepository(ref.watch(apiClientProvider));
});

class FleetRepository {
  FleetRepository(this._api);

  final ApiClient _api;

  /// GET /v1/me/orgs — ticketing companies the subject owns.
  Future<List<OrgSummary>> myOrgs() async {
    final res = await _api.get('/v1/me/orgs');
    final list = (res['orgs'] as List?) ?? const [];
    return list
        .map((e) => OrgSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/fleet/active-trips?orgSlug= — open duty trips, passenger
  /// projection (no crew names, no GPS).
  Future<List<ActiveTrip>> activeTrips(String orgSlug) async {
    final res = await _api.get('/v1/fleet/active-trips?orgSlug=$orgSlug');
    final list = (res['trips'] as List?) ?? const [];
    return list
        .map((e) => ActiveTrip.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/fleet/orgs/:orgId/trips — full duty rows for managers.
  Future<List<FleetTrip>> orgTrips(String orgId) async {
    final res = await _api.get('/v1/fleet/orgs/$orgId/trips');
    final list = (res['trips'] as List?) ?? const [];
    return list
        .map((e) => FleetTrip.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/fleet/orgs/:orgId/vehicles.
  Future<List<FleetVehicle>> vehicles(String orgId) async {
    final res = await _api.get('/v1/fleet/orgs/$orgId/vehicles');
    final list = (res['vehicles'] as List?) ?? const [];
    return list
        .map((e) => FleetVehicle.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/fleet/orgs/:orgId/crew.
  Future<List<CrewMember>> crew(String orgId) async {
    final res = await _api.get('/v1/fleet/orgs/$orgId/crew');
    final list = (res['crew'] as List?) ?? const [];
    return list
        .map((e) => CrewMember.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/ticketorgs/:id/staff-grants — the unified-crew-identity
  /// roster (docs/proposals/esoko-unified-crew-identity.md): every
  /// Party who can act as staff for this org, and their live
  /// active/suspended status.
  Future<List<OrgStaffGrant>> staffGrants(String orgId) async {
    final res = await _api.get('/v1/ticketorgs/$orgId/staff-grants');
    final list = (res['staff'] as List?) ?? const [];
    return list
        .map((e) => OrgStaffGrant.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/ticketorgs/:id/staff-grants — onboards a crew member who
  /// already holds an Esoko account (looked up by phone number). 404s
  /// with NO_ACCOUNT if they don't — there is no account-less path, by
  /// design (see the proposal's "crew must have accounts" decision).
  Future<void> createStaffGrant({
    required String orgId,
    required String msisdn,
    required String role,
    String? crewMemberId,
  }) {
    return _api.post('/v1/ticketorgs/$orgId/staff-grants', {
      'msisdn': msisdn,
      'role': role,
      if (crewMemberId != null) 'crewMemberId': crewMemberId,
    });
  }

  /// POST /v1/ticketorgs/:id/staff-grants/:partyId/suspend — kills the
  /// person's live activation immediately and marks the grant suspended;
  /// reinstating is a separate, deliberate step (see [reinstateStaffGrant]).
  Future<void> suspendStaffGrant(String orgId, String partyId) {
    return _api.post('/v1/ticketorgs/$orgId/staff-grants/$partyId/suspend');
  }

  /// POST /v1/ticketorgs/:id/staff-grants/:partyId/reinstate — only
  /// clears the suspension; the person still needs a fresh OTP to
  /// actually switch back on duty (core-go never auto-restores a live
  /// activation here).
  Future<void> reinstateStaffGrant(String orgId, String partyId) {
    return _api.post('/v1/ticketorgs/$orgId/staff-grants/$partyId/reinstate');
  }

  /// GET /v1/fleet/orgs/:orgId/positions — latest ping per vehicle.
  Future<List<VehiclePosition>> positions(String orgId) async {
    final res = await _api.get('/v1/fleet/orgs/$orgId/positions');
    final list = (res['positions'] as List?) ?? const [];
    return list
        .map((e) => VehiclePosition.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/fleet/trips/:id/collections — declared cash vs M-Pesa.
  Future<CollectionsSummary> collections(String tripId) async {
    final res = await _api.get('/v1/fleet/trips/$tripId/collections');
    final summary = res['summary'] as Map<String, dynamic>?;
    return CollectionsSummary.fromJson(summary ?? const {});
  }

  /// GET /v1/trips/resolve — turn a scanned code (esoko://t?... or
  /// BUS-XXXXXX) into a payable trip. The resolve payload uses
  /// lowercase keys (unlike the Go-struct shapes above), so the stage
  /// mapping lives here, not scattered across the two callers
  /// (scan-bus + fare-pay bootstrap).
  Future<ResolvedTrip?> resolveTrip(String code) async {
    final res = await _api.get(
      '/v1/trips/resolve?code=${Uri.encodeComponent(code.trim())}',
    );
    final t = res['trip'] as Map<String, dynamic>?;
    if (t == null || t['tripId'] == null) return null;
    final stages = ((t['stages'] as List?) ?? const [])
        .map(
          (e) => FareStage.fromJson({
            'ID': e['id'],
            'Name': e['name'],
            'Order': 0,
            'FareKES': e['fareKes'],
          }),
        )
        .toList();
    return ResolvedTrip(
      orgSlug: (t['orgSlug'] as String?) ?? '',
      trip: ActiveTrip(
        tripId: t['tripId'] as String,
        vehiclePlate: (t['vehiclePlate'] as String?) ?? '',
        routeName: t['routeName'] as String?,
        stages: stages,
      ),
    );
  }

  /// POST /v1/fares — pay for one trip leg. The tripQrCode passthrough
  /// lets Go re-verify the scan HMAC instead of trusting a tripId.
  Future<PlacedFare> payFare({
    required ActiveTrip trip,
    FareStage? stage,
    required String tripQrCode,
    required String method,
    String? voucherId,
    required String buyerName,
    required String buyerMsisdn,
  }) async {
    final res = await _api.post('/v1/fares', {
      if (tripQrCode.isEmpty)
        'tripId': trip.tripId
      else
        'tripQrCode': tripQrCode,
      if (stage case final s?) ...{
        'stageToId': s.id,
        'amountKes': double.tryParse(s.fareKes) ?? 0,
      },
      'method': method,
      if (voucherId case final v? when method == 'VOUCHER') 'voucherId': v,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
    });
    return PlacedFare(
      fareId: res['fareId'] as String?,
      totalKes: res['totalKes'] as String?,
      confirmed: res['status'] == 'CONFIRMED',
      paymentError: res['paymentError'] as String?,
    );
  }

  /// True once the fare has flipped to CONFIRMED — the poll loop calls
  /// this, not the screen.
  Future<bool> isFareConfirmed(String fareId) async {
    final res = await _api.get('/v1/fares/$fareId');
    final fare = res['fare'] as Map<String, dynamic>?;
    return fare?['Status'] == 'CONFIRMED';
  }

  /// POST /v1/fares/verify — tout receipt check. Returns the raw
  /// verification map; the screen renders it.
  Future<Map<String, dynamic>?> verifyFare(String code, String scopeTripId) async {
    final res = await _api.post('/v1/fares/verify', {
      'code': code.trim(),
      if (scopeTripId.isNotEmpty) 'scopeTripId': scopeTripId,
    });
    return res['verification'] as Map<String, dynamic>?;
  }

  /// POST /v1/fleet/trips/:id/declare — record counted cash.
  Future<void> declareCash({
    required String tripId,
    required String crewId,
    required double amountKes,
  }) {
    return _api.post('/v1/fleet/trips/$tripId/declare', {
      'crewId': crewId,
      'declaredCashKes': amountKes,
    });
  }

  /// POST /v1/fleet/trips/:id/close — note/endStatus are the crew
  /// end-of-shift additions (see TripEndStatus); both stay optional so
  /// a manager closing without either still works exactly as before.
  Future<void> closeTrip(String tripId, {String? note, String? endStatus}) {
    return _api.post('/v1/fleet/trips/$tripId/close', {
      if (note != null) 'note': note,
      if (endStatus != null) 'endStatus': endStatus,
    });
  }

  /// GET /v1/fleet/my-trip — crew-scoped "which trip am I on right now"
  /// (an AGENT-only read; a SUBJECT session always gets null here). See
  /// dbx.MyActiveTrip.
  Future<MyTrip?> myActiveTrip() async {
    final res = await _api.get('/v1/fleet/my-trip');
    final t = res['trip'] as Map<String, dynamic>?;
    return t == null ? null : MyTrip.fromJson(t);
  }
}

/// GET /v1/fleet/my-trip's projection — just enough to head the crew
/// shift screen.
class MyTrip {
  const MyTrip({
    required this.id,
    required this.vehiclePlate,
    this.routeName,
    required this.startedAt,
    required this.crewMemberId,
  });

  factory MyTrip.fromJson(Map<String, dynamic> json) => MyTrip(
        id: json['ID'] as String,
        vehiclePlate: json['VehiclePlate'] as String,
        routeName: json['RouteName'] as String?,
        startedAt: json['StartedAt'] as String,
        crewMemberId: json['CrewMemberID'] as String,
      );

  final String id;
  final String vehiclePlate;
  final String? routeName;
  final String startedAt;
  final String crewMemberId;
}

/// A resolved scan: which org it belongs to (for the manual fallback)
/// plus the payable trip itself.
class ResolvedTrip {
  const ResolvedTrip({required this.orgSlug, required this.trip});

  final String orgSlug;
  final ActiveTrip trip;
}

/// The shaped answer to POST /v1/fares the fare stage machine acts on.
class PlacedFare {
  const PlacedFare({
    this.fareId,
    this.totalKes,
    required this.confirmed,
    this.paymentError,
  });

  final String? fareId;
  final String? totalKes;
  final bool confirmed;
  final String? paymentError;
}
