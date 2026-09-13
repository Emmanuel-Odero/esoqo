import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/money/money.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../parcels/courier_earnings_screen.dart';
import '../parcels/parcels_hub_screen.dart' show codHoldingProvider;
import '../vouchers/voucher_models.dart';
import '../vouchers/voucher_providers.dart';
import '../vouchers/voucher_wallet_screen.dart';

/// The "what's mine" destination.
///
/// Before this, a person's own money was scattered across whichever
/// service happened to touch it first: vouchers only reachable from
/// Transport or the scanner, courier earnings only from Parcels'
/// Nearby tab, points buried at the bottom of a 608-line Settings
/// scroll. None of those places is where somebody looks for money —
/// they look here, the way they'd look at a wallet.
///
/// Every figure on this screen is read-only. Creating a voucher,
/// issuing an allowance batch, and the full earnings statement all
/// still live in their existing screens (VoucherWalletScreen,
/// CourierEarningsScreen) — this is the front page that tells you
/// those exist and what they currently hold, not a second copy of
/// their forms.
class MoneyScreen extends ConsumerWidget {
  const MoneyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final loyalty = ref.watch(myLoyaltyProvider);
    final vouchers = ref.watch(myVouchersProvider);
    final cod = ref.watch(codHoldingProvider);
    final earnings = ref.watch(courierEarningsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(myLoyaltyProvider);
        ref.invalidate(myVouchersProvider);
        ref.invalidate(codHoldingProvider);
        ref.invalidate(courierEarningsProvider);
      },
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              EsokoSpacing.s6,
              EsokoSpacing.s4,
              EsokoSpacing.s6,
              EsokoSpacing.s9 + EsokoSpacing.s6,
            ),
            children: [
              EsokoSectionHeader(
                title: 'Money',
                subtitle:
                    "What's yours across Esoko — vouchers, points, and any cash you're carrying for someone else.",
              ),
              const SizedBox(height: EsokoSpacing.s5),
              EsokoAsyncView(
                value: loyalty,
                isEmpty: (_) => false,
                onRetry: () => ref.invalidate(myLoyaltyProvider),
                data: (context, summary) => _WalletHero(
                  summary: summary,
                  voucherTotal: _voucherTotal(vouchers),
                  voucherCount: vouchers.valueOrNull?.length ?? 0,
                ),
              ),
              const SizedBox(height: EsokoSpacing.s3),

              // Somebody else's money in this person's pocket — never
              // folded into the hero above, so it can never be mistaken
              // for money that's theirs to spend. See
              // SCREEN_CONVENTIONS.md Rule 3: amber, not green.
              if (cod.valueOrNull?.amountKes.isPositive ?? false)
                Padding(
                  padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
                  child: EsokoInlineNotice(
                    color: EsokoColors.amber,
                    icon: EsokoIconName.truck,
                    message:
                        'Carrying KES ${cod.value!.amountKes.format()} for '
                        '${cod.value!.parcelCount} ${cod.value!.parcelCount == 1 ? 'parcel' : 'parcels'} — hand it over when you settle up.',
                  ),
                ),

              // Only somebody who has actually delivered something
              // sees this — the same "render nothing until it's real"
              // rule the payment-plans section already follows.
              if (earnings.valueOrNull case final e?
                  when e.earnings.deliveredTotal > 0 ||
                      e.earnings.unpaidParcels > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
                  child: EsokoListTile(
                    title: 'Your courier earnings',
                    subtitle: e.earnings.unpaidKes.isPositive
                        ? 'KES ${e.earnings.unpaidKes.format()} waiting to be paid'
                        : 'KES ${e.earnings.paidKes.format()} paid so far',
                    icon: Icons.local_shipping_outlined,
                    iconColor: EsokoColors.green,
                    iconBackground: EsokoColors.greenTint,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const CourierEarningsScreen(),
                      ),
                    ),
                  ),
                ),

              const SizedBox(height: EsokoSpacing.s2),
              EsokoButton.secondary(
                label: 'Manage your vouchers',
                icon: Icons.wallet_outlined,
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const VoucherWalletScreen(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Best-effort, non-blocking, same pattern home_hub_screen's own
  /// reorder signals use: the hero renders off [loyalty] alone and
  /// upgrades itself the moment the vouchers list resolves, rather
  /// than making the whole screen wait on two round trips.
  static Money _voucherTotal(AsyncValue<List<VoucherCard>> vouchers) {
    final list = vouchers.valueOrNull;
    if (list == null || list.isEmpty) return Money.zero;
    return Money.sum(list.map((v) => v.balanceKes));
  }
}

class _WalletHero extends StatelessWidget {
  const _WalletHero({
    required this.summary,
    required this.voucherTotal,
    required this.voucherCount,
  });

  final LoyaltySummary summary;
  final Money voucherTotal;
  final int voucherCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return EsokoCard(
      color: scheme.primaryContainer,
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Vouchers', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: EsokoSpacing.s1),
          Text(
            'KES ${voucherTotal.format()}',
            style: EsokoTypography.mono(fontSize: 26, fontWeight: FontWeight.w800),
          ),
          Text(
            voucherCount == 0
                ? 'No vouchers yet'
                : '$voucherCount ${voucherCount == 1 ? 'card' : 'cards'}',
          ),
          const Divider(height: EsokoSpacing.s6),
          Row(
            children: [
              Icon(Icons.stars_rounded, color: scheme.primary),
              const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${summary.totalPoints} points',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text('≈ KES ${summary.kesEquiv} · 10 pts = KES 1'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
