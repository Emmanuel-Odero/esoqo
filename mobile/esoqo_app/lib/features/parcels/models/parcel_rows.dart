import '../../../core/money/money.dart';

/// One line on "parcels I sent" or "parcels I'm holding" — wire type
/// matching dbx.ParcelRow. deliveryCode/priceKes only populate on the
/// sender's own list.
class ParcelRow {
  ParcelRow({
    required this.id,
    required this.code,
    this.deliveryCode,
    required this.senderName,
    required this.receiverName,
    required this.originLabel,
    required this.destinationLabel,
    required this.status,
    this.priceKes,
    required this.createdAt,
    this.deliveredAt,
    this.deliveryAttempts = 0,
    this.lastAttemptReason,
    this.codAmountKes,
    this.codStatus = 'NONE',
    this.codCollectDeliveryFee = false,
  });

  factory ParcelRow.fromJson(Map<String, dynamic> json) => ParcelRow(
    id: json['ID'] as String,
    code: json['Code'] as String,
    deliveryCode: json['DeliveryCode'] as String?,
    senderName: json['SenderName'] as String,
    receiverName: json['ReceiverName'] as String,
    originLabel: json['OriginLabel'] as String,
    destinationLabel: json['DestinationLabel'] as String,
    status: json['Status'] as String,
    priceKes: json['PriceKes'] as String?,
    createdAt:
        DateTime.tryParse(json['CreatedAt'] as String? ?? '') ?? DateTime.now(),
    deliveredAt: json['DeliveredAt'] == null
        ? null
        : DateTime.tryParse(json['DeliveredAt'] as String),
    deliveryAttempts: (json['DeliveryAttempts'] as num?)?.toInt() ?? 0,
    lastAttemptReason: json['LastAttemptReason'] as String?,
    codAmountKes: Money.tryParse(json['CodAmountKes'] as String?),
    codStatus: json['CodStatus'] as String? ?? 'NONE',
    codCollectDeliveryFee: json['CodCollectDeliveryFee'] as bool? ?? false,
  );

  final String id;
  final String code;
  final String? deliveryCode;
  final String senderName;
  final String receiverName;
  final String originLabel;
  final String destinationLabel;
  final String status;
  final String? priceKes;
  final DateTime createdAt;
  final DateTime? deliveredAt;

  // DeliveryAttempts/LastAttemptReason only populate on the holder's
  // own list (see dbx.ListParcelsHeld) — a courier is the only person
  // who can act on "this one has already failed twice".
  final int deliveryAttempts;
  final String? lastAttemptReason;

  // COD terms, on the holder's list only: a courier standing at a door
  // needs to know what to ask for before they knock.
  final Money? codAmountKes;
  final String codStatus;

  /// Whether the delivery fee is collected at the door too, on top of
  /// [codAmountKes].
  final bool codCollectDeliveryFee;

  /// True when there is cash to collect at the door and it hasn't been
  /// collected yet — what makes the delivery screen refuse to close
  /// without recording what was actually paid.
  bool get needsCodCollection =>
      codStatus == 'PENDING' && codExpectedKes.isPositive;

  /// The whole figure to ask for: the goods, plus the delivery fee when
  /// this parcel collects that at the door as well.
  Money get codExpectedKes {
    final goods = codAmountKes ?? Money.zero;
    if (!codCollectDeliveryFee) return goods;
    return goods + (Money.tryParse(priceKes) ?? Money.zero);
  }

  /// The delivery-fee half of [codExpectedKes], for the "X for the
  /// goods + Y delivery" breakdown a courier reads out at the door.
  Money get codDeliveryFeeKes =>
      codExpectedKes - (codAmountKes ?? Money.zero);
}

/// One custody transfer, names resolved for display — wire type
/// matching dbx.HandoffRow. fromName is null on the very first pickup
/// (meaning "from the sender").
class ParcelHandoffRow {
  ParcelHandoffRow({this.fromName, required this.toName, required this.createdAt});

  factory ParcelHandoffRow.fromJson(Map<String, dynamic> json) =>
      ParcelHandoffRow(
        fromName: json['FromName'] as String?,
        toName: json['ToName'] as String,
        createdAt: DateTime.tryParse(json['CreatedAt'] as String? ?? '') ??
            DateTime.now(),
      );

  final String? fromName;
  final String toName;
  final DateTime createdAt;
}

/// One claimable job — wire type matching dbx.AvailableJob. distanceKm
/// is null when either the courier hasn't posted a ping yet or the
/// parcel has no origin zone — see ListAvailableJobs's own comment on
/// why an unranked job still shows up, just last.
class AvailableJob {
  AvailableJob({
    required this.code,
    required this.originLabel,
    required this.destinationLabel,
    required this.parcelType,
    this.priceKes,
    this.distanceKm,
  });

  factory AvailableJob.fromJson(Map<String, dynamic> json) => AvailableJob(
    code: json['Code'] as String,
    originLabel: json['OriginLabel'] as String,
    destinationLabel: json['DestinationLabel'] as String,
    parcelType: json['ParcelType'] as String,
    priceKes: json['PriceKes'] as String?,
    distanceKm: (json['DistanceKm'] as num?)?.toDouble(),
  );

  final String code;
  final String originLabel;
  final String destinationLabel;
  final String parcelType;
  final String? priceKes;
  final double? distanceKm;
}

/// How much collected cash a rider is still carrying — wire type
/// matching dbx.RiderCodHolding. This is the number they count their
/// pockets against at the end of a round.
class RiderCodHolding {
  RiderCodHolding({required this.parcelCount, required this.amountKes});

  factory RiderCodHolding.fromJson(Map<String, dynamic> json) =>
      RiderCodHolding(
        parcelCount: (json['parcelCount'] as num?)?.toInt() ?? 0,
        amountKes: Money.fromJson(json['amountKes']) ?? Money.zero,
      );

  final int parcelCount;
  final Money amountKes;
}
