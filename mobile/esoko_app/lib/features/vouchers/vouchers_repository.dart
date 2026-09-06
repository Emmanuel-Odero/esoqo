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
}
