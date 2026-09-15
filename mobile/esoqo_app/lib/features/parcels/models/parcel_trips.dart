/// One stop on a bus route, for the "where does it come off" picker —
/// wire type matching dbx.TripStage.
class TripStage {
  TripStage({required this.id, required this.name, required this.order});

  factory TripStage.fromJson(Map<String, dynamic> json) => TripStage(
    id: json['id'] as String,
    name: json['name'] as String,
    order: (json['order'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String name;
  final int order;
}

/// A bus a parcel could ride right now — wire type matching
/// dbx.DepartingTrip. Only trips with a named route appear: one with no
/// stages has nowhere to get off, so choosing it would be picking a
/// vehicle with no destination.
class DepartingTrip {
  DepartingTrip({
    required this.tripId,
    required this.routeName,
    required this.vehiclePlate,
    required this.orgName,
    this.startedAt,
    this.stageCount = 0,
    this.parcelsOnBoard = 0,
  });

  factory DepartingTrip.fromJson(Map<String, dynamic> json) => DepartingTrip(
    tripId: json['tripId'] as String,
    routeName: json['routeName'] as String? ?? '',
    vehiclePlate: json['vehiclePlate'] as String? ?? '',
    orgName: json['orgName'] as String? ?? '',
    startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
    stageCount: (json['stageCount'] as num?)?.toInt() ?? 0,
    parcelsOnBoard: (json['parcelsOnBoard'] as num?)?.toInt() ?? 0,
  );

  final String tripId;
  final String routeName;
  final String vehiclePlate;
  final String orgName;
  final DateTime? startedAt;
  final int stageCount;
  final int parcelsOnBoard;
}
