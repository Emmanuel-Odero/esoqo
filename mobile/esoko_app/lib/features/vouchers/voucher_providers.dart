import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'voucher_models.dart';
import 'vouchers_repository.dart';

/// GET /v1/me/vouchers — owner's cards with derived balances.
final myVouchersProvider = FutureProvider.autoDispose<List<VoucherCard>>(
  (ref) => ref.watch(vouchersRepositoryProvider).myVouchers(),
);

/// GET /v1/me/loyalty — unified points + KES equiv (10 pts = KES 1).
final myLoyaltyProvider = FutureProvider.autoDispose<LoyaltySummary>(
  (ref) => ref.watch(vouchersRepositoryProvider).myLoyalty(),
);
