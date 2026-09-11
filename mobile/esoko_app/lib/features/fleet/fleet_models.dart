/// Wire types for the transport fleet surface — matches core-go's Go
/// struct JSON (see services/core-go/internal/dbx/fleet.go and
/// ticket_orgs.go). Gin marshals without tags, so keys are the
/// capitalised Go field names, except CollectionsSummary which carries
/// explicit lowercase json tags.
class OrgSummary {
  OrgSummary({
    required this.id,
    required this.name,
    required this.slug,
    required this.vertical,
    required this.status,
  });

  factory OrgSummary.fromJson(Map<String, dynamic> json) => OrgSummary(
        id: json['ID'] as String,
        name: json['Name'] as String,
        slug: json['Slug'] as String,
        vertical: json['Vertical'] as String,
        status: json['Status'] as String,
      );

  final String id;
  final String name;
  final String slug;
  final String vertical;
  final String status;
}

class FareStage {
  FareStage({
    required this.id,
    required this.name,
    required this.order,
    required this.fareKes,
  });

  factory FareStage.fromJson(Map<String, dynamic> json) => FareStage(
        id: json['ID'] as String,
        name: json['Name'] as String,
        order: json['Order'] as int? ?? 0,
        fareKes: json['FareKES'] as String? ?? '0',
      );

  final String id;
  final String name;
  final int order;
  final String fareKes;
}

/// One open duty trip, passenger projection — no crew names, no GPS
/// (see dbx.PublicActiveTrip).
class ActiveTrip {
  ActiveTrip({
    required this.tripId,
    required this.vehiclePlate,
    this.routeName,
    this.stages = const [],
  });

  factory ActiveTrip.fromJson(Map<String, dynamic> json) => ActiveTrip(
        tripId: json['TripID'] as String,
        vehiclePlate: json['VehiclePlate'] as String,
        routeName: json['RouteName'] as String?,
        stages: ((json['Stages'] as List?) ?? const [])
            .map((e) => FareStage.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String tripId;
  final String vehiclePlate;
  final String? routeName;
  final List<FareStage> stages;

  String get label => routeName ?? 'Trip $tripId';
}

class FleetVehicle {
  FleetVehicle({
    required this.id,
    required this.plateNo,
    this.capacity,
    this.label,
    required this.status,
  });

  factory FleetVehicle.fromJson(Map<String, dynamic> json) => FleetVehicle(
        id: json['ID'] as String,
        plateNo: json['PlateNo'] as String,
        capacity: json['Capacity'] as int?,
        label: json['Label'] as String?,
        status: json['Status'] as String? ?? 'ACTIVE',
      );

  final String id;
  final String plateNo;
  final int? capacity;
  final String? label;
  final String status;

  bool get grounded => status != 'ACTIVE';
}

class CrewMember {
  CrewMember({
    required this.id,
    required this.name,
    required this.role,
    required this.active,
  });

  factory CrewMember.fromJson(Map<String, dynamic> json) => CrewMember(
        id: json['ID'] as String,
        name: json['Name'] as String,
        role: json['Role'] as String? ?? 'CONDUCTOR',
        active: json['Active'] as bool? ?? true,
      );

  final String id;
  final String name;
  final String role;
  final bool active;
}

/// One row on the org's staff roster — GET /v1/ticketorgs/:id/staff-grants
/// (docs/proposals/esoko-unified-crew-identity.md). Distinct from
/// [CrewMember]: a staff grant is a *person's account's* permission to
/// act as SCANNER/MANAGER/ADMIN/CREW for this org; a CrewMember is the
/// driver/conductor roster entry a CREW grant may (or may not yet) be
/// linked to — see [crewMemberId].
class OrgStaffGrant {
  const OrgStaffGrant({
    required this.partyId,
    required this.partyName,
    required this.msisdn,
    required this.role,
    required this.status,
    this.crewMemberId,
  });

  factory OrgStaffGrant.fromJson(Map<String, dynamic> json) => OrgStaffGrant(
        partyId: json['partyId'] as String,
        partyName: json['partyName'] as String? ?? 'Staff member',
        msisdn: json['msisdn'] as String?,
        role: json['role'] as String,
        status: json['status'] as String,
        crewMemberId: json['crewMemberId'] as String?,
      );

  final String partyId;
  final String partyName;
  final String? msisdn;
  final String role; // SCANNER | MANAGER | ADMIN | CREW
  final String status; // active | suspended
  final String? crewMemberId;

  bool get suspended => status == 'suspended';
}

/// Full duty-trip row for managers — includes crew names (authenticated
/// read, see dbx.ListTrips).
class FleetTrip {
  FleetTrip({
    required this.id,
    required this.vehiclePlate,
    this.driverName,
    this.conductorName,
    required this.status,
    required this.startedAt,
    this.endedAt,
  });

  factory FleetTrip.fromJson(Map<String, dynamic> json) => FleetTrip(
        id: json['ID'] as String,
        vehiclePlate: json['VehiclePlate'] as String? ?? '',
        driverName: json['DriverName'] as String?,
        conductorName: json['ConductorName'] as String?,
        status: json['Status'] as String? ?? 'ACTIVE',
        startedAt: json['StartedAt'] as String? ?? '',
        endedAt: json['EndedAt'] as String?,
      );

  final String id;
  final String vehiclePlate;
  final String? driverName;
  final String? conductorName;
  final String status;
  final String startedAt;
  final String? endedAt;

  bool get active => status == 'ACTIVE';

  /// "Who is the driver and tout at any particular time" — one line.
  String get crewLabel {
    final d = driverName ?? '—';
    final c = conductorName ?? '—';
    return 'Driver: $d · Tout: $c';
  }
}

class VehiclePosition {
  VehiclePosition({
    required this.tripId,
    required this.vehiclePlate,
    required this.lat,
    required this.lng,
    required this.at,
  });

  factory VehiclePosition.fromJson(Map<String, dynamic> json) =>
      VehiclePosition(
        tripId: json['TripID'] as String,
        vehiclePlate: json['VehiclePlate'] as String? ?? '',
        lat: json['Lat'] as String? ?? '',
        lng: json['Lng'] as String? ?? '',
        at: json['At'] as String? ?? '',
      );

  final String tripId;
  final String vehiclePlate;
  final String lat;
  final String lng;
  final String at;
}

class CollectionsSummary {
  CollectionsSummary({
    required this.mpesaConfirmedKes,
    required this.cashFaresKes,
    required this.voucherConfirmedKes,
    required this.declaredCashKes,
    required this.cashVarianceKes,
    required this.fareCount,
    required this.declarationCount,
  });

  factory CollectionsSummary.fromJson(Map<String, dynamic> json) =>
      CollectionsSummary(
        mpesaConfirmedKes: json['mpesaConfirmedKes'] as String? ?? '0',
        cashFaresKes: json['cashFaresKes'] as String? ?? '0',
        voucherConfirmedKes: json['voucherConfirmedKes'] as String? ?? '0',
        declaredCashKes: json['declaredCashKes'] as String? ?? '0',
        cashVarianceKes: json['cashVarianceKes'] as String? ?? '0',
        fareCount: json['fareCount'] as int? ?? 0,
        declarationCount: json['declarationCount'] as int? ?? 0,
      );

  final String mpesaConfirmedKes;
  final String cashFaresKes;
  final String voucherConfirmedKes;
  final String declaredCashKes;
  final String cashVarianceKes;
  final int fareCount;
  final int declarationCount;

  bool get hasVariance {
    final v = double.tryParse(cashVarianceKes) ?? 0;
    return v < -0.005 || v > 0.005;
  }
}
