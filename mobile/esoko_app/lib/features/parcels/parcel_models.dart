/// The 5 parcel-type brackets from the standard rate card (see
/// ParcelPricingRule / packages/db's 20260910000001 migration) — id is
/// the wire value core-go expects, label is what the sender sees.
const parcelTypes = [
  ('ENVELOPE_DOCUMENT', 'Envelope / Document'),
  ('SMALL', 'Small parcel'),
  ('MEDIUM', 'Medium parcel'),
  ('LARGE', 'Large parcel'),
  ('HEAVY_OVERSIZE', 'Heavy / Oversize'),
];

String parcelTypeLabel(String parcelType) {
  for (final t in parcelTypes) {
    if (t.$1 == parcelType) return t.$2;
  }
  return parcelType;
}

/// One admin-configured "make an offer" option — wire type matching
/// dbx.BargainReason. Never a free-typed discount: the price this
/// implies is always re-derived server-side by SetParcelPrice.
class BargainReason {
  BargainReason({required this.reason, required this.extraDiscountPct});

  factory BargainReason.fromJson(Map<String, dynamic> json) => BargainReason(
    reason: json['reason'] as String,
    extraDiscountPct: (json['extraDiscountPct'] as num).toDouble(),
  );

  final String reason;
  final double extraDiscountPct;
}

/// The price band + bargain rules for one parcel type — wire type
/// matching dbx.ParcelPricing (GET /v1/parcels/pricing).
class ParcelPricing {
  ParcelPricing({
    required this.parcelType,
    required this.weightLabel,
    required this.minWeightKg,
    required this.maxWeightKg,
    required this.minKes,
    required this.maxKes,
    required this.bargainMinPct,
    required this.bargainMaxPct,
    required this.bargainReasons,
    required this.suggestedTransportMode,
    this.distanceKm,
  });

  factory ParcelPricing.fromJson(Map<String, dynamic> json) => ParcelPricing(
    parcelType: json['parcelType'] as String,
    weightLabel: json['weightLabel'] as String,
    minWeightKg: (json['minWeightKg'] as num).toDouble(),
    maxWeightKg: (json['maxWeightKg'] as num).toDouble(),
    minKes: (json['minKes'] as num).toDouble(),
    maxKes: (json['maxKes'] as num).toDouble(),
    bargainMinPct: (json['bargainMinPct'] as num).toDouble(),
    bargainMaxPct: (json['bargainMaxPct'] as num).toDouble(),
    bargainReasons: ((json['bargainReasons'] as List?) ?? const [])
        .map((e) => BargainReason.fromJson(e as Map<String, dynamic>))
        .toList(),
    suggestedTransportMode: json['suggestedTransportMode'] as String,
    // Only present when the caller passed both zone ids — see
    // ParcelsRepository.getPricing's own comment.
    distanceKm: (json['distanceKm'] as num?)?.toDouble(),
  );

  final String parcelType;
  final String weightLabel;
  final double minWeightKg;
  final double maxWeightKg;
  final double minKes;
  final double maxKes;
  final double bargainMinPct;
  final double bargainMaxPct;
  final List<BargainReason> bargainReasons;
  final String suggestedTransportMode;
  final double? distanceKm;

  /// True when [weightKg] falls in this bracket — the client-side half
  /// of "enter a weight, get a matching parcel type", mirrored against
  /// the same minWeightKg/maxWeightKg BookParcel's admin-configured
  /// ParcelPricingRule carries server-side.
  bool coversWeightKg(double weightKg) =>
      weightKg >= minWeightKg && weightKg <= maxWeightKg;

  /// The price a given [reason] resolves to — mirrors dbx.SetParcelPrice's
  /// server-side math exactly, so what the sender sees here is what the
  /// server will actually accept. Purely a UI preview; the server still
  /// re-derives and enforces this itself.
  double priceForReason(BargainReason reason) {
    var pct = bargainMinPct + reason.extraDiscountPct;
    if (pct > bargainMaxPct) pct = bargainMaxPct;
    return minKes * (1 - pct / 100);
  }
}

/// Picks the bracket [weightKg] falls into from a full, lightest-first
/// [pricingList] (see ParcelsRepository.getAllPricing) — over the top
/// of the heaviest bracket, that heaviest bracket is still returned
/// (courier dispatch always has *some* price, never "unpriced").
ParcelPricing? matchParcelPricingForWeight(
  List<ParcelPricing> pricingList,
  double weightKg,
) {
  for (final p in pricingList) {
    if (p.coversWeightKg(weightKg)) return p;
  }
  return pricingList.isEmpty ? null : pricingList.last;
}

/// The guest-safe status pill projection — wire type matching Go's
/// dbx.ParcelStatusView. No sender/receiver name or phone: same
/// PII-minimal rule every other public scan result in this app follows.
class ParcelStatusView {
  ParcelStatusView({
    required this.code,
    required this.status,
    required this.originLabel,
    required this.destinationLabel,
    required this.parcelType,
    this.priceKes,
    this.collectionScheduledAt,
    required this.createdAt,
    this.deliveredAt,
    this.cancellationReason,
    this.cancelledAt,
    this.receiptConfirmedAt,
    this.preLabel = false,
    this.preLabelInfo,
  });

  factory ParcelStatusView.fromJson(Map<String, dynamic> json) =>
      ParcelStatusView(
        code: json['code'] as String,
        status: json['status'] as String,
        originLabel: json['originLabel'] as String,
        destinationLabel: json['destinationLabel'] as String,
        parcelType: json['parcelType'] as String? ?? 'SMALL',
        priceKes: json['priceKes'] as String?,
        collectionScheduledAt: json['collectionScheduledAt'] == null
            ? null
            : DateTime.tryParse(json['collectionScheduledAt'] as String),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
                DateTime.now(),
        deliveredAt: json['deliveredAt'] == null
            ? null
            : DateTime.tryParse(json['deliveredAt'] as String),
        cancellationReason: json['cancellationReason'] as String?,
        cancelledAt: json['cancelledAt'] == null
            ? null
            : DateTime.tryParse(json['cancelledAt'] as String),
        receiptConfirmedAt: json['receiptConfirmedAt'] == null
            ? null
            : DateTime.tryParse(json['receiptConfirmedAt'] as String),
        preLabel: json['preLabel'] as bool? ?? false,
        preLabelInfo: json['preLabelInfo'] == null
            ? null
            : ParcelLabelInfo.fromJson(
                json['preLabelInfo'] as Map<String, dynamic>),
      );

  final String code;
  final String status; // DRAFT_PENDING_PAYMENT | BOOKED | PICKED_UP | IN_TRANSIT | DELIVERED | CANCELLED | LABEL_PRINTED
  final String originLabel;
  final String destinationLabel;
  final String parcelType;
  final String? priceKes;
  final DateTime? collectionScheduledAt;
  final DateTime createdAt;
  final DateTime? deliveredAt;
  final String? cancellationReason;
  final DateTime? cancelledAt;
  final DateTime? receiptConfirmedAt;
  // preLabel/preLabelInfo — a pre-printed label (see
  // dbx.ParcelLabelStock) that was scanned/tracked before ever
  // becoming a real booking. status reads "LABEL_PRINTED" in that
  // case; every other field above is meaningless (blank/zero) except
  // createdAt. preLabelInfo is null until at least an item description
  // has been attached in the field (see the admin "Attach info to a
  // label" screen), even for a genuinely pre-printed (but still blank)
  // label.
  final bool preLabel;
  final ParcelLabelInfo? preLabelInfo;
}

/// The structured info a handler attached to a pre-printed label in
/// the field — wire type matching Go's dbx.ParcelLabelInfo.
class ParcelLabelInfo {
  ParcelLabelInfo({
    required this.itemDescription,
    this.destination,
    this.ownerName,
    this.ownerContact,
    this.ownerGender,
    this.itemType,
    this.weightRangeKg,
    required this.attachedAt,
  });

  factory ParcelLabelInfo.fromJson(Map<String, dynamic> json) =>
      ParcelLabelInfo(
        itemDescription: json['itemDescription'] as String,
        destination: json['destination'] as String?,
        ownerName: json['ownerName'] as String?,
        ownerContact: json['ownerContact'] as String?,
        ownerGender: json['ownerGender'] as String?,
        itemType: json['itemType'] as String?,
        weightRangeKg: json['weightRangeKg'] as String?,
        attachedAt:
            DateTime.tryParse(json['attachedAt'] as String? ?? '') ??
                DateTime.now(),
      );

  final String itemDescription;
  final String? destination;
  final String? ownerName;
  final String? ownerContact;
  final String? ownerGender;
  final String? itemType;
  final String? weightRangeKg;
  final DateTime attachedAt;
}

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
}

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

const parcelStatusStages = [
  ('BOOKED', 'Booked'),
  ('PICKED_UP', 'Picked up'),
  ('IN_TRANSIT', 'In transit'),
  ('DELIVERED', 'Delivered'),
];

/// Real, per-status sentences for [ParcelStatusScreen] — replaces a
/// bare enum label with the same "who/what/next step" tone
/// notify.Parcel* uses for SMS, so the in-app copy and the text the
/// sender gets are never at odds with each other.
String parcelStatusMessage(ParcelStatusView status) {
  switch (status.status) {
    case 'DRAFT_PENDING_PAYMENT':
      return 'This booking is still a draft — finish paying to confirm it.';
    case 'BOOKED':
      if (status.collectionScheduledAt != null) {
        return 'Collection is scheduled — someone will come by for it soon.';
      }
      return "Booked and paid. We'll text you once it's on its way.";
    case 'PICKED_UP':
      return 'Picked up and on its way to ${status.destinationLabel}.';
    case 'IN_TRANSIT':
      return 'In transit to ${status.destinationLabel}.';
    case 'DELIVERED':
      return 'Delivered to ${status.destinationLabel}.';
    case 'CANCELLED':
      return status.cancellationReason == null
          ? 'Cancelled — see your SMS for details.'
          : 'Cancelled — ${status.cancellationReason}.';
    case 'LABEL_PRINTED':
      return status.preLabelInfo == null
          ? "This is a pre-printed label — it hasn't been attached to a shipment yet."
          : 'Pre-printed label — attached to: ${status.preLabelInfo!.itemDescription}';
    default:
      return status.status;
  }
}

/// The label projection a handler/courier prints and sticks on the
/// physical parcel — wire type matching dbx.ParcelLabel (GET
/// /v1/parcels/:code/label). Deliberately thin: no phone numbers
/// beyond the last 4 digits, no price, no sender/receiver address —
/// see that struct's own comment for why a label stays PII-minimal.
class ParcelLabel {
  ParcelLabel({
    required this.code,
    required this.status,
    required this.parcelType,
    this.weightKg,
    required this.originLabel,
    required this.destinationLabel,
    required this.receiverName,
    required this.receiverPhoneLast4,
    required this.createdAt,
  });

  factory ParcelLabel.fromJson(Map<String, dynamic> json) => ParcelLabel(
    code: json['code'] as String,
    status: json['status'] as String,
    parcelType: json['parcelType'] as String,
    weightKg: (json['weightKg'] as num?)?.toDouble(),
    originLabel: json['originLabel'] as String,
    destinationLabel: json['destinationLabel'] as String,
    receiverName: json['receiverName'] as String,
    receiverPhoneLast4: json['receiverPhoneLast4'] as String? ?? '',
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
  );

  final String code;
  final String status;
  final String parcelType;
  final double? weightKg;
  final String originLabel;
  final String destinationLabel;
  final String receiverName;
  final String receiverPhoneLast4;
  final DateTime createdAt;
}
