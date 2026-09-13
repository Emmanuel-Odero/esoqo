import '../../core/money/money.dart';

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
    this.agentDropDiscountPct = 0,
    this.coverageFeeKes,
  });

  factory ParcelPricing.fromJson(Map<String, dynamic> json) => ParcelPricing(
    parcelType: json['parcelType'] as String,
    weightLabel: json['weightLabel'] as String,
    minWeightKg: (json['minWeightKg'] as num).toDouble(),
    maxWeightKg: (json['maxWeightKg'] as num).toDouble(),
    minKes: Money.fromJson(json['minKes']) ?? Money.zero,
    maxKes: Money.fromJson(json['maxKes']) ?? Money.zero,
    bargainMinPct: (json['bargainMinPct'] as num).toDouble(),
    bargainMaxPct: (json['bargainMaxPct'] as num).toDouble(),
    bargainReasons: ((json['bargainReasons'] as List?) ?? const [])
        .map((e) => BargainReason.fromJson(e as Map<String, dynamic>))
        .toList(),
    suggestedTransportMode: json['suggestedTransportMode'] as String,
    // Only present when the caller passed both zone ids — see
    // ParcelsRepository.getPricing's own comment.
    distanceKm: (json['distanceKm'] as num?)?.toDouble(),
    agentDropDiscountPct:
        (json['agentDropDiscountPct'] as num?)?.toDouble() ?? 0,
    coverageFeeKes: Money.fromJson(json['coverageFeeKes']),
  );

  final String parcelType;
  final String weightLabel;
  final double minWeightKg;
  final double maxWeightKg;
  final Money minKes;
  final Money maxKes;
  final double bargainMinPct;
  final double bargainMaxPct;
  final List<BargainReason> bargainReasons;
  final String suggestedTransportMode;
  final double? distanceKm;

  /// How much cheaper a drop at a pickup point is than a doorstep run,
  /// as a percentage — the server's own figure (see
  /// handleGetParcelPricing), never re-derived here.
  final double agentDropDiscountPct;

  /// What the chosen cover tier costs for the declared value the quote
  /// was requested with. Null when no cover was selected.
  final Money? coverageFeeKes;

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
  Money priceForReason(BargainReason reason) {
    var pct = bargainMinPct + reason.extraDiscountPct;
    if (pct > bargainMaxPct) pct = bargainMaxPct;
    return minKes.discounted(pct);
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
    this.slaDeadlineAt,
    this.deliveryAttempts = 0,
    this.lastAttemptAt,
    this.lastAttemptReason,
    this.lastAttemptText,
    this.podPhotoUrl,
    this.podReceivedByName,
    this.podMethod,
    this.agent,
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
        slaDeadlineAt: json['slaDeadlineAt'] == null
            ? null
            : DateTime.tryParse(json['slaDeadlineAt'] as String),
        deliveryAttempts: (json['deliveryAttempts'] as num?)?.toInt() ?? 0,
        lastAttemptAt: json['lastAttemptAt'] == null
            ? null
            : DateTime.tryParse(json['lastAttemptAt'] as String),
        lastAttemptReason: json['lastAttemptReason'] as String?,
        lastAttemptText: json['lastAttemptText'] as String?,
        podPhotoUrl: json['podPhotoUrl'] as String?,
        podReceivedByName: json['podReceivedByName'] as String?,
        podMethod: json['podMethod'] as String?,
        agent: json['agent'] == null
            ? null
            : ParcelAgentStop.fromJson(json['agent'] as Map<String, dynamic>),
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

  /// The delivery promise, frozen at payment time — what lets the
  /// tracking page say "arriving by 4pm" instead of showing a stepper
  /// with no sense of time.
  final DateTime? slaDeadlineAt;

  // Failed-attempt summary. A receiver who was out needs to know an
  // attempt happened and why far more than they need the status
  // string; without these a FAILED_DELIVERY parcel reads as "stuck"
  // with no explanation and no obvious next step.
  final int deliveryAttempts;
  final DateTime? lastAttemptAt;
  final String? lastAttemptReason;
  final String? lastAttemptText;

  // Proof of delivery — a narrow, deliberate departure from this
  // projection's PII-minimal rule (see dbx.ParcelStatusView): the whole
  // value of POD is that sender and receiver can settle "who actually
  // took it" between themselves, and the tracking code is by design
  // the credential only those two hold.
  final String? podPhotoUrl;
  final String? podReceivedByName;
  final String? podMethod;

  /// Where to collect it, when the parcel is on a pickup point's shelf
  /// (HELD_AT_AGENT). Null for a doorstep delivery.
  final ParcelAgentStop? agent;

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
    this.destinationLat,
    this.destinationLng,
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
    destinationLat: (json['destinationLat'] as num?)?.toDouble(),
    destinationLng: (json['destinationLng'] as num?)?.toDouble(),
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

  // The destination pin, for the one person who needs to navigate to
  // it. Behind the same custody gate the rest of this projection is —
  // a pin is more precise than the free-text label and has no business
  // on the guest-safe view, or printed in the open on a box.
  final double? destinationLat;
  final double? destinationLng;

  /// True only when both halves are present. Half a pin is not a
  /// location, and offering "navigate" on one would send a courier
  /// somewhere confidently wrong — worse than the written label.
  bool get hasDestinationPin =>
      destinationLat != null && destinationLng != null;
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

/// One level of loss cover — wire type matching dbx.ParcelCoverageTier
/// plus the three figures handleListCoverageTiers quotes against the
/// declared value. The fee and the payout are the server's arithmetic;
/// this only renders them, so "covered up to KES X" can never be a
/// different number from what the fee was charged on.
class ParcelCoverageTier {
  ParcelCoverageTier({
    required this.id,
    required this.name,
    required this.maxCoverKes,
    required this.feeKes,
    required this.feePct,
    this.active = true,
    this.sortOrder = 0,
    required this.feeForValueKes,
    required this.coveredAmountKes,
    this.capsDeclaredAmount = false,
  });

  factory ParcelCoverageTier.fromJson(Map<String, dynamic> json) =>
      ParcelCoverageTier(
        id: json['id'] as String,
        name: json['name'] as String,
        maxCoverKes: Money.fromJson(json['maxCoverKes']) ?? Money.zero,
        feeKes: Money.fromJson(json['feeKes']) ?? Money.zero,
        feePct: (json['feePct'] as num?)?.toDouble() ?? 0,
        active: json['active'] as bool? ?? true,
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
        feeForValueKes: Money.fromJson(json['feeForValueKes']) ?? Money.zero,
        coveredAmountKes:
            Money.fromJson(json['coveredAmountKes']) ?? Money.zero,
        capsDeclaredAmount: json['capsDeclaredAmount'] as bool? ?? false,
      );

  final String id;
  final String name;
  final Money maxCoverKes;
  final Money feeKes;

  /// A rate, not an amount — percentages have no smallest unit to be
  /// exact about, which is why this stays a double while the figures
  /// beside it are [Money].
  final double feePct;
  final bool active;
  final int sortOrder;

  /// What this tier costs for the declared value it was quoted against.
  final Money feeForValueKes;

  /// What a claim would actually pay out: the declared amount, capped
  /// at this tier's ceiling.
  final Money coveredAmountKes;

  /// True when the ceiling bit — so the UI can say "covers KES 25,000
  /// of the KES 40,000 you declared" rather than quietly showing a
  /// smaller number than the sender typed.
  final bool capsDeclaredAmount;
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

/// A courier's own money, in totals — wire type matching
/// dbx.CourierEarnings.
class CourierEarnings {
  CourierEarnings({
    required this.unpaidKes,
    required this.unpaidParcels,
    required this.paidKes,
    required this.deliveredTotal,
    required this.earnedTodayKes,
  });

  factory CourierEarnings.fromJson(Map<String, dynamic> json) =>
      CourierEarnings(
        unpaidKes: Money.fromJson(json['unpaidKes']) ?? Money.zero,
        unpaidParcels: (json['unpaidParcels'] as num?)?.toInt() ?? 0,
        paidKes: Money.fromJson(json['paidKes']) ?? Money.zero,
        deliveredTotal: (json['deliveredTotal'] as num?)?.toInt() ?? 0,
        earnedTodayKes: Money.fromJson(json['earnedTodayKes']) ?? Money.zero,
      );

  final Money unpaidKes;
  final int unpaidParcels;
  final Money paidKes;
  final int deliveredTotal;

  /// What today came to — the question a courier actually opens the
  /// screen to ask, which is not "what is my lifetime total".
  final Money earnedTodayKes;
}

/// One delivery on a courier's statement — wire type matching
/// dbx.CourierEarningRow.
class CourierEarningRow {
  CourierEarningRow({
    required this.code,
    required this.destinationLabel,
    required this.earnedKes,
    this.deliveredAt,
    this.paid = false,
  });

  factory CourierEarningRow.fromJson(Map<String, dynamic> json) =>
      CourierEarningRow(
        code: json['code'] as String,
        destinationLabel: json['destinationLabel'] as String? ?? '',
        earnedKes: Money.fromJson(json['earnedKes']) ?? Money.zero,
        deliveredAt: DateTime.tryParse(json['deliveredAt'] as String? ?? ''),
        paid: json['paid'] as bool? ?? false,
      );

  final String code;
  final String destinationLabel;
  final Money earnedKes;
  final DateTime? deliveredAt;
  final bool paid;
}

/// The one global courier rate — wire type matching
/// dbx.ParcelCourierTariff. The two components stack: a courier earns
/// [perDeliveryKes] plus [pctOfPrice] of what the sender paid. Either
/// may be zero, which is how "flat rate only" and "commission only" are
/// expressed without a mode flag.
class CourierTariff {
  CourierTariff({
    required this.perDeliveryKes,
    required this.pctOfPrice,
    required this.maxPerDeliveryKes,
  });

  factory CourierTariff.fromJson(Map<String, dynamic> json) => CourierTariff(
    perDeliveryKes: Money.fromJson(json['perDeliveryKes']) ?? Money.zero,
    pctOfPrice: (json['pctOfPrice'] as num?)?.toDouble() ?? 0,
    maxPerDeliveryKes:
        Money.fromJson(json['maxPerDeliveryKes']) ?? Money.zero,
  );

  final Money perDeliveryKes;
  final double pctOfPrice;
  final Money maxPerDeliveryKes;

  /// The rate in plain language. "Why is this 300?" is the first
  /// question anybody asks about their own pay, and a screen that
  /// can't answer it invites a phone call.
  String get describe {
    final parts = <String>[];
    if (perDeliveryKes.isPositive) {
      parts.add('KES ${perDeliveryKes.format()} a delivery');
    }
    if (pctOfPrice > 0) {
      parts.add('${pctOfPrice.toStringAsFixed(0)}% of what the sender paid');
    }
    if (parts.isEmpty) return 'No courier rate is set yet.';
    final base = 'You earn ${parts.join(' plus ')}.';
    if (!maxPerDeliveryKes.isPositive) return base;
    return '$base Capped at KES ${maxPerDeliveryKes.format()} a delivery.';
  }
}

/// The whole courier-earnings screen in one shape: the totals, the
/// statement behind them, and the rate both were derived from.
class CourierEarningsView {
  CourierEarningsView({
    required this.earnings,
    required this.deliveries,
    required this.tariff,
  });

  final CourierEarnings earnings;
  final List<CourierEarningRow> deliveries;
  final CourierTariff tariff;
}

/// Why a delivery attempt failed. Fixed options rather than free text
/// because these drive what the receiver is told and what the courier
/// is asked to do next — but OTHER always ships with its own free-text
/// field, the same rule every other "Other" choice in this codebase
/// follows.
const parcelAttemptReasons = [
  ('RECEIVER_UNREACHABLE', 'Nobody answered'),
  ('WRONG_ADDRESS', 'Address was wrong'),
  ('RECEIVER_ABSENT', 'Receiver was out'),
  ('REFUSED', 'Receiver refused it'),
  ('ACCESS_BLOCKED', 'Could not get in'),
  ('OTHER', 'Something else'),
];

/// Short, human status text. Every list in this app used to render the
/// raw enum — a sender genuinely saw "PKG-X · IN_TRANSIT" in their Sent
/// list while the detail screen beside it showed a written sentence.
/// A status string is a database value; it is never what a person
/// should read. Mirrors apps/web's STATUS_LABEL so the two clients
/// never describe the same parcel differently.
const _parcelStatusLabels = {
  'DRAFT_PENDING_PAYMENT': 'Draft — not paid',
  'BOOKED': 'Booked',
  'PICKED_UP': 'Picked up',
  'IN_TRANSIT': 'In transit',
  'HELD_AT_AGENT': 'Waiting at a pickup point',
  'FAILED_DELIVERY': 'Delivery attempt failed',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
  'RETURNED_TO_SENDER': 'Returned to sender',
  'LABEL_PRINTED': 'Label printed, not booked',
};

String parcelStatusLabel(String status) => _parcelStatusLabels[status] ?? status;

/// True for a status that isn't a point on [parcelStatusStages].
///
/// The timeline is the happy path. A cancelled or failed parcel has no
/// place on it, and forcing one on would draw a stepper that implies
/// the parcel is still moving.
bool parcelStatusIsOffTimeline(String status) =>
    !parcelStatusStages.any((s) => s.$1 == status);

/// A timestamp as somebody would say it out loud — "12 minutes ago",
/// "yesterday", "on 3 Feb". Null renders as an em dash rather than an
/// empty gap, so a missing time reads as missing rather than broken.
String parcelHumanTime(DateTime? at) {
  if (at == null) return '—';
  final now = DateTime.now();
  final local = at.toLocal();
  final diff = now.difference(local);

  if (diff.isNegative) {
    final ahead = local.difference(now);
    if (ahead.inMinutes < 60) return 'in ${ahead.inMinutes} min';
    if (ahead.inHours < 24) return 'in ${ahead.inHours}h';
    return 'on ${_shortDate(local)}';
  }
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) {
    return '${diff.inMinutes} ${diff.inMinutes == 1 ? 'minute' : 'minutes'} ago';
  }
  if (diff.inHours < 24) {
    return '${diff.inHours} ${diff.inHours == 1 ? 'hour' : 'hours'} ago';
  }
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return 'on ${_shortDate(local)}';
}

const _monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _shortDate(DateTime at) {
  final month = _monthNames[at.month - 1];
  final now = DateTime.now();
  if (at.year == now.year) return '${at.day} $month';
  return '${at.day} $month ${at.year}';
}

/// The delivery promise, phrased as one. Null when there's no SLA for
/// the type or the parcel is already closed — "arriving by" on a
/// delivered parcel is noise, and on an overdue one it's worse than
/// noise, so that case gets its own honest wording instead.
String? parcelEtaText(ParcelStatusView status) {
  const closed = {'DELIVERED', 'CANCELLED', 'RETURNED_TO_SENDER'};
  if (closed.contains(status.status) || status.slaDeadlineAt == null) {
    return null;
  }
  if (status.slaDeadlineAt!.isBefore(DateTime.now())) {
    return 'Running later than promised — we\'re on it.';
  }
  return 'Arriving by ${parcelHumanTime(status.slaDeadlineAt)}';
}