import '../../../core/money/money.dart';

/// An admin-curated hub with coordinates — what actually drives
/// distance-based pricing and the dispatch map now, since free-text
/// origin/destination was never geocoded (see ParcelStatusView's own
/// comment). Picking one is optional; skipping it just means a flat,
/// weight-only price — same graceful-degradation the server side
/// already follows.
class ParcelZone {
  ParcelZone({required this.id, required this.name, required this.lat, required this.lng});

  factory ParcelZone.fromJson(Map<String, dynamic> json) => ParcelZone(
    id: json['id'] as String,
    name: json['name'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
  );

  final String id;
  final String name;
  final double lat;
  final double lng;
}

/// A neighbourhood pickup point — wire type matching dbx.ParcelAgent.
/// The cheap leg: a courier serving one shop that twenty receivers walk
/// to costs a fraction of twenty doorstep runs.
class ParcelAgent {
  ParcelAgent({
    required this.id,
    required this.name,
    this.partyId,
    this.zoneId,
    this.zoneName,
    required this.lat,
    required this.lng,
    required this.msisdn,
    required this.locationHint,
    this.openingHours,
    this.active = true,
    this.capacity = 0,
    required this.holdingFeeKes,
    this.parcelsHeld = 0,
  });

  factory ParcelAgent.fromJson(Map<String, dynamic> json) => ParcelAgent(
    id: json['id'] as String,
    name: json['name'] as String,
    partyId: json['partyId'] as String?,
    zoneId: json['zoneId'] as String?,
    zoneName: json['zoneName'] as String?,
    lat: (json['lat'] as num?)?.toDouble() ?? 0,
    lng: (json['lng'] as num?)?.toDouble() ?? 0,
    msisdn: json['msisdn'] as String? ?? '',
    locationHint: json['locationHint'] as String? ?? '',
    openingHours: json['openingHours'] as String?,
    active: json['active'] as bool? ?? true,
    capacity: (json['capacity'] as num?)?.toInt() ?? 0,
    holdingFeeKes: Money.fromJson(json['holdingFeeKes']) ?? Money.zero,
    parcelsHeld: (json['parcelsHeld'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String name;
  final String? partyId;
  final String? zoneId;
  final String? zoneName;
  final double lat;
  final double lng;
  final String msisdn;
  final String locationHint;
  final String? openingHours;
  final bool active;
  final int capacity;
  final Money holdingFeeKes;

  /// How many parcels are on this shelf right now. Counted per row
  /// server-side rather than denormalised — a stale shelf count is
  /// worse than no shelf count.
  final int parcelsHeld;

  /// True when the shelf is full. A capacity of zero means "unlimited"
  /// rather than "full": an unconfigured shop should still take
  /// parcels, which is how it behaved before capacities existed.
  bool get isFull => capacity > 0 && parcelsHeld >= capacity;
}

/// The collection-point details a receiver needs — wire type matching
/// dbx.ParcelAgentStop. Deliberately cut down from [ParcelAgent]: no
/// capacity, no shelf count, no owning party, because those are
/// operational numbers that are nobody's business at the door.
class ParcelAgentStop {
  ParcelAgentStop({
    required this.name,
    required this.msisdn,
    required this.locationHint,
    this.openingHours,
    required this.lat,
    required this.lng,
    required this.holdingFeeKes,
  });

  factory ParcelAgentStop.fromJson(Map<String, dynamic> json) =>
      ParcelAgentStop(
        name: json['name'] as String? ?? '',
        msisdn: json['msisdn'] as String? ?? '',
        locationHint: json['locationHint'] as String? ?? '',
        openingHours: json['openingHours'] as String?,
        lat: (json['lat'] as num?)?.toDouble() ?? 0,
        lng: (json['lng'] as num?)?.toDouble() ?? 0,
        holdingFeeKes: Money.fromJson(json['holdingFeeKes']) ?? Money.zero,
      );

  final String name;
  final String msisdn;
  final String locationHint;
  final String? openingHours;
  final double lat;
  final double lng;
  final Money holdingFeeKes;
}
