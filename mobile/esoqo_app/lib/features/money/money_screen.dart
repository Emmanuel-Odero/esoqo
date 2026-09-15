import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../parcels/courier_earnings_screen.dart';
import '../parcels/parcel_models.dart' show CourierEarningsView;
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
              EsoqoSpacing.s6,
              EsoqoSpacing.s4,
              EsoqoSpacing.s6,
              EsoqoSpacing.s9 + EsoqoSpacing.s6,
            ),
            children: [
              EsoqoSectionHeader(
                title: 'Wallet',
                subtitle:
                    "What's yours across Esoqo — vouchers, points, and any cash you're carrying for someone else.",
              ),
              const SizedBox(height: EsoqoSpacing.s5),
              // The headline is what you hold, in navy — the
                  // proposal's wallet hero. Navy rather than the green
                  // primaryContainer this first shipped with: a balance
                  // is a statement of record, not an action you're
                  // being invited to take, and green is the colour of
                  // the latter (SCREEN_CONVENTIONS.md Rule 3).
              _WalletHero(
                voucherTotal: _voucherTotal(vouchers),
                voucherCount: vouchers.valueOrNull?.length ?? 0,
                loyalty: loyalty.valueOrNull,
              ),
              const SizedBox(height: EsoqoSpacing.s3),

              // Two figures worth seeing without a tap, side by side.
              // Points sits here rather than in the hero because it is
              // a different kind of money — earned, not loaded — and
              // the hero should answer one question, not two.
              _StatRow(
                loyalty: loyalty.valueOrNull,
                earnings: earnings.valueOrNull,
              ),

              // Somebody else's money in this person's pocket — never
              // folded into the hero above, so it can never be mistaken
              // for money that's theirs to spend. See
              // SCREEN_CONVENTIONS.md Rule 3: amber, not green.
              if (cod.valueOrNull case final h? when h.amountKes.isPositive) ...[
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoAttentionCard(
                  when: 'Carrying for others',
                  title: 'KES ${h.amountKes.format()}',
                  detail:
                      '${h.parcelCount} ${h.parcelCount == 1 ? 'parcel' : 'parcels'} · hand it over when you settle up',
                  accent: EsoqoColors.amber,
                ),
              ],

              // Only somebody who has actually delivered something
              // sees this — the same "render nothing until it's real"
              // rule the payment-plans section already follows.
              if (earnings.valueOrNull case final e?
                  when e.earnings.deliveredTotal > 0 ||
                      e.earnings.unpaidParcels > 0) ...[
                const SizedBox(height: EsoqoSpacing.s5),
                const EsoqoSubHeader('Your earnings'),
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoListTile(
                  title: e.earnings.unpaidKes.isPositive
                      ? 'KES ${e.earnings.unpaidKes.format()} waiting to be paid'
                      : 'KES ${e.earnings.paidKes.format()} paid so far',
                  subtitle: '${e.earnings.deliveredTotal} '
                      '${e.earnings.deliveredTotal == 1 ? 'delivery' : 'deliveries'} · see the statement',
                  icon: Icons.local_shipping_outlined,
                  iconColor: EsoqoColors.green,
                  iconBackground: EsoqoColors.greenTint,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const CourierEarningsScreen(),
                    ),
                  ),
                ),
              ],

              const SizedBox(height: EsoqoSpacing.s5),
              const EsoqoSubHeader('Your cards'),
              const SizedBox(height: EsoqoSpacing.s3),
              EsoqoAsyncView(
                value: vouchers,
                isEmpty: (list) => list.isEmpty,
                emptyMessage:
                    'No vouchers yet — a fare card, a shopping card, or one '
                    'somebody gifted you all show up here.',
                emptyIcon: Icons.wallet_outlined,
                onRetry: () => ref.invalidate(myVouchersProvider),
                data: (context, list) => Column(
                  children: [
                    for (var i = 0; i < list.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
                        child: EsoqoStagger(
                          index: i,
                          child: EsoqoListTile(
                            title: list[i].label,
                            subtitle:
                                'KES ${list[i].balanceKes.format()} · ${_purposeLabel(list[i].purpose)}',
                            icon: Icons.wallet_outlined,
                            trailing: list[i].status == 'ACTIVE'
                                ? null
                                : EsoqoStatusPill(
                                    label: list[i].status,
                                    color: EsoqoColors.amber,
                                  ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),

              const SizedBox(height: EsoqoSpacing.s3),
              EsoqoButton.secondary(
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

  /// The wire purpose (FARE, RENT, SHOPPING, GENERAL) as something a
  /// person would say. GENERAL becomes "Any shop" rather than the
  /// literal word, which tells somebody nothing about what the card
  /// can actually buy.
  static String _purposeLabel(String purpose) => switch (purpose) {
        'FARE' => 'Fare',
        'RENT' => 'Rent',
        'SHOPPING' => 'Shopping',
        _ => 'Any shop',
      };
}

class _WalletHero extends StatelessWidget {
  const _WalletHero({
    required this.voucherTotal,
    required this.voucherCount,
    this.loyalty,
  });

  final Money voucherTotal;
  final int voucherCount;

  /// Null while the loyalty call is still in flight — the hero draws
  /// its voucher half immediately and fills this line in when it
  /// lands, rather than holding the whole card behind a second round
  /// trip.
  final LoyaltySummary? loyalty;

  @override
  Widget build(BuildContext context) {
    return EsoqoCard(
      color: EsoqoColors.navy,
      padding: const EdgeInsets.all(EsoqoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Vouchers',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontSize: EsoqoTypeScale.meta,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: EsoqoSpacing.s1),
          Text(
            'KES ${voucherTotal.format()}',
            style: EsoqoTypography.mono(
              fontSize: EsoqoTypeScale.hero,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          Text(
            voucherCount == 0
                ? 'No vouchers yet'
                : '$voucherCount ${voucherCount == 1 ? 'card' : 'cards'}',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontSize: EsoqoTypeScale.meta,
            ),
          ),
        ],
      ),
    );
  }
}

/// The two figures that sit beside each other under the hero — points
/// you have earned, and money you are owed. Both render as a dash
/// rather than a zero while their provider is still resolving: "—"
/// reads as "not known yet", where "KES 0" reads as a fact, and the
/// wrong fact about somebody's money is worse than no fact.
class _StatRow extends StatelessWidget {
  const _StatRow({this.loyalty, this.earnings});

  final LoyaltySummary? loyalty;
  final CourierEarningsView? earnings;

  @override
  Widget build(BuildContext context) {
    final owed = earnings?.earnings.unpaidKes;
    // IntrinsicHeight so the two cards match height whichever has the
    // longer detail line — `stretch` alone would resolve to infinity
    // here, because a ListView child has no bounded height to stretch
    // to. Same fix, same reason, as EsoqoAttentionCard's own edge.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: _Stat(
              label: 'Points',
              value: loyalty == null ? '—' : '${loyalty!.totalPoints}',
              detail: loyalty == null ? null : '10 pts = KES 1',
            ),
          ),
          const SizedBox(width: EsoqoSpacing.s3),
          Expanded(
            child: _Stat(
              label: 'Owed to you',
              value: owed == null ? '—' : 'KES ${owed.format()}',
              detail: owed == null ? null : 'from deliveries',
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.detail});

  final String label;
  final String value;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return EsoqoCard(
      padding: const EdgeInsets.all(EsoqoSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EsoqoTypography.mono(
              fontSize: EsoqoTypeScale.subTitle,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (detail != null)
            Text(detail!, style: TextStyle(fontSize: EsoqoTypeScale.micro, color: muted)),
        ],
      ),
    );
  }
}
