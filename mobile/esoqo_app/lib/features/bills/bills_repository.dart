import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'bill_models.dart';

/// The bills feature slice of the Riverpod convention (see
/// ARCHITECTURE.md). Track-and-remind by default: marking something
/// paid never moves money — see the Bill model's doc comment on the Go
/// side. The one exception is bill funding (targetKes set): a
/// BillContribution is real money, M-Pesa-settled, same as any other
/// checkout in this app.
final billsRepositoryProvider = Provider<BillsRepository>((ref) {
  return BillsRepository(ref.watch(apiClientProvider));
});

class BillsRepository {
  BillsRepository(this._api);

  final ApiClient _api;

  /// GET /v1/me/bills — everything the user tracks, newest first.
  Future<List<BillRow>> myBills() async {
    final res = await _api.get('/v1/me/bills');
    final list = (res['bills'] as List?) ?? const [];
    return list
        .map((e) => BillRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/me/bills — adds a track-and-remind bill. Returns the new
  /// bill's id so a caller can immediately turn funding on for it (see
  /// setFundingTarget) without a second round-trip to look it up.
  Future<String> addBill({
    required String label,
    required String category,
    String? accountRef,
    double? amountKes,
    required String cycle,
    required DateTime nextDueAt,
  }) async {
    final res = await _api.post('/v1/me/bills', {
      'label': label,
      'category': category,
      if (accountRef != null && accountRef.isNotEmpty) 'accountRef': accountRef,
      'amountKes': ?amountKes,
      'cycle': cycle,
      'nextDueAt': nextDueAt.toUtc().toIso8601String(),
    });
    return res['billId'] as String;
  }

  /// POST /v1/me/bills/:id/pay — records "I paid this outside Esoko";
  /// it never initiates or moves money.
  Future<void> markPaid(String id, double amountKes) {
    return _api.post('/v1/me/bills/$id/pay', {'amountKes': amountKes});
  }

  /// PATCH /v1/me/bills/:id — turns funding on for a bill (or updates
  /// its target/auto-pay setting).
  Future<void> setFundingTarget({
    required String id,
    required double targetKes,
    required bool autoPayEnabled,
  }) {
    return _api.patch('/v1/me/bills/$id', {
      'targetKes': targetKes,
      'autoPayEnabled': autoPayEnabled,
    });
  }

  /// GET /v1/bills/:id/funding — guest-safe, for a shared funding link.
  Future<BillFundingSummary> funding(String id) async {
    final res = await _api.get('/v1/bills/$id/funding');
    return BillFundingSummary.fromJson(res);
  }

  /// GET /v1/bills/:id/contributions — who's chipped in so far.
  Future<List<BillContributionRow>> contributions(String id) async {
    final res = await _api.get('/v1/bills/$id/contributions');
    final list = (res['contributions'] as List?) ?? const [];
    return list
        .map((e) => BillContributionRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/bills/:id/contributions — a friend/family member chipping
  /// in. Guest-safe; no sign-in required.
  Future<ContributionResult> contribute({
    required String billId,
    required String contributorName,
    required String contributorMsisdn,
    required double amountKes,
  }) async {
    final res = await _api.post('/v1/bills/$billId/contributions', {
      'contributorName': contributorName,
      'contributorMsisdn': contributorMsisdn,
      'amountKes': amountKes,
    });
    return ContributionResult(
      paid: (res['status'] as String?)?.toUpperCase() == 'PAID',
    );
  }
}

class ContributionResult {
  const ContributionResult({required this.paid});
  final bool paid;
}
