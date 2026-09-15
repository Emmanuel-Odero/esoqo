import '../../core/money/money.dart';

/// Wire types for voucher cards — matches core-go handlers_voucher.go.
class VoucherCard {
  VoucherCard({
    required this.id,
    required this.label,
    required this.purpose,
    required this.status,
    required this.shortCode,
    required this.qrPayload,
    required this.balancePoints,
    required this.balanceKes,
  });

  factory VoucherCard.fromJson(Map<String, dynamic> json) => VoucherCard(
    id: json['id'] as String,
    label: json['label'] as String? ?? 'Voucher',
    purpose: json['purpose'] as String? ?? 'GENERAL',
    status: json['status'] as String? ?? 'ACTIVE',
    shortCode: json['shortCode'] as String? ?? '',
    qrPayload: json['qrPayload'] as String? ?? '',
    balancePoints: (json['balancePoints'] as num?)?.toInt() ?? 0,
    balanceKes: Money.fromJson(json['balanceKes']) ?? Money.zero,
  );

  final String id;
  final String label;
  final String purpose;
  final String status;
  final String shortCode;
  final String qrPayload;
  final int balancePoints;
  final Money balanceKes;

  bool get frozen => status != 'ACTIVE';
}

/// GET /v1/me/loyalty — unified points + KES equivalent. The spend/earn
/// rules themselves (10 pts = KES 1, 10% of every spend) live in Go and
/// are not repeated client-side.
class LoyaltySummary {
  LoyaltySummary({required this.totalPoints, required this.kesEquiv});

  factory LoyaltySummary.fromJson(Map<String, dynamic> json) => LoyaltySummary(
    totalPoints: (json['totalPoints'] as num?)?.toInt() ?? 0,
    kesEquiv: (json['kesEquiv'] as num?)?.toDouble() ?? 0,
  );

  final int totalPoints;
  final double kesEquiv;
}
