import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'voucher_models.dart';

/// The vouchers feature slice of the Riverpod convention (see
/// ARCHITECTURE.md): the wallet watches tiny `FutureProvider`s that
/// delegate here. Raw maps never reach the screen — loyalty is now a
/// shaped [LoyaltySummary], and voucher creation is a single call.
final vouchersRepositoryProvider = Provider<VouchersRepository>((ref) {
  return VouchersRepository(ref.watch(apiClientProvider));
});

class VouchersRepository {
  VouchersRepository(this._api);

  final ApiClient _api;

  /// GET /v1/me/vouchers — owner's cards with derived balances.
  Future<List<VoucherCard>> myVouchers() async {
    final res = await _api.get('/v1/me/vouchers');
    final list = (res['vouchers'] as List?) ?? const [];
    return list
        .map((e) => VoucherCard.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/me/loyalty — unified points + KES equivalent.
  Future<LoyaltySummary> myLoyalty() async {
    final res = await _api.get('/v1/me/loyalty');
    return LoyaltySummary.fromJson(res);
  }

  /// POST /v1/vouchers — creates a purpose-locked card, optionally gifted
  /// to [recipientMsisdn] (see CreateVoucher on the Go side — every rule
  /// like the 10pts=KES1 redemption lives there).
  Future<void> createVoucher({
    required String label,
    required String purpose,
    required double amountKes,
    required String loadMethod,
    String? recipientMsisdn,
  }) {
    return _api.post('/v1/vouchers', {
      'label': label,
      'purpose': purpose,
      'amountKes': amountKes,
      'loadMethod': loadMethod,
      if (recipientMsisdn != null && recipientMsisdn.isNotEmpty)
        'recipientMsisdn': recipientMsisdn,
    });
  }

  /// POST /v1/me/voucher-batches — an employer's one M-Pesa payment
  /// fanning out to N employee FUEL/TRAVEL allowance vouchers (see
  /// dbx.IssueAllowanceVoucherBatch). Employees are given by phone
  /// number, not party id — the server resolves/creates each Person,
  /// same pattern gifting a single voucher already uses.
  Future<IssuedAllowanceBatch> issueAllowanceBatch({
    required String purpose,
    required String label,
    required double amountPerEmployeeKes,
    required List<String> employeeMsisdns,
    required String employerMsisdn,
  }) async {
    final res = await _api.post('/v1/me/voucher-batches', {
      'purpose': purpose,
      'label': label,
      'amountPerEmployeeKes': amountPerEmployeeKes,
      'employeeMsisdns': employeeMsisdns,
      'employerMsisdn': employerMsisdn,
    });
    return IssuedAllowanceBatch(
      batchId: res['batchId'] as String? ?? '',
      totalKes: (res['totalKes'] as num?)?.toDouble() ?? 0,
      status: res['status'] as String? ?? 'PENDING_PAYMENT',
    );
  }

  /// GET /v1/me/voucher-batches — the employer's own "batches I've
  /// issued" list.
  Future<List<VoucherBatchRow>> myVoucherBatches() async {
    final res = await _api.get('/v1/me/voucher-batches');
    final list = (res['batches'] as List?) ?? const [];
    return list
        .map((e) => VoucherBatchRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

class IssuedAllowanceBatch {
  const IssuedAllowanceBatch({
    required this.batchId,
    required this.totalKes,
    required this.status,
  });
  final String batchId;
  final double totalKes;
  final String status;
  bool get paid => status.toUpperCase() == 'ISSUED';
}

/// Wire type matching dbx.VoucherBatchRow.
class VoucherBatchRow {
  VoucherBatchRow({
    required this.id,
    required this.purpose,
    required this.label,
    required this.amountPerEmployeeKes,
    required this.employeeCount,
    required this.status,
    required this.issuedCount,
    required this.createdAt,
  });

  factory VoucherBatchRow.fromJson(Map<String, dynamic> json) =>
      VoucherBatchRow(
        id: json['ID'] as String,
        purpose: json['Purpose'] as String,
        label: json['Label'] as String,
        amountPerEmployeeKes: json['AmountPerEmployeeKES'] as String,
        employeeCount: json['EmployeeCount'] as int? ?? 0,
        status: json['Status'] as String,
        issuedCount: json['IssuedCount'] as int? ?? 0,
        createdAt: json['CreatedAt'] as String,
      );

  final String id;
  final String purpose;
  final String label;
  final String amountPerEmployeeKes;
  final int employeeCount;
  final String status;
  final int issuedCount;
  final String createdAt;
}
