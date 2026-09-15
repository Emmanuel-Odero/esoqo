import '../../../core/money/money.dart';

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
