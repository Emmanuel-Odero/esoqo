import '../../../core/money/money.dart';

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
