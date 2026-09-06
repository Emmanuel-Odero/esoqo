import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'bill_models.dart';

/// The bills feature slice of the Riverpod convention (see
/// ARCHITECTURE.md). Track-and-remind only: marking something paid never
/// moves money — see the Bill model's doc comment on the Go side.
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

  /// POST /v1/me/bills — adds a track-and-remind bill.
  Future<void> addBill({
    required String label,
    required String category,
    String? accountRef,
    double? amountKes,
    required String cycle,
    required DateTime nextDueAt,
  }) {
    return _api.post('/v1/me/bills', {
      'label': label,
      'category': category,
      if (accountRef != null && accountRef.isNotEmpty) 'accountRef': accountRef,
      'amountKes': ?amountKes,
      'cycle': cycle,
      'nextDueAt': nextDueAt.toUtc().toIso8601String(),
    });
  }

  /// POST /v1/me/bills/:id/pay — records "I paid this outside Esoko";
  /// it never initiates or moves money.
  Future<void> markPaid(String id, double amountKes) {
    return _api.post('/v1/me/bills/$id/pay', {'amountKes': amountKes});
  }
}
