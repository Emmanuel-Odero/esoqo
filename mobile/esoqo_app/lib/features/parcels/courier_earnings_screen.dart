import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcels_repository.dart';

final courierEarningsProvider = FutureProvider.autoDispose<CourierEarningsView>(
  (ref) => ref.watch(parcelsRepositoryProvider).courierEarnings(),
);

/// A courier's own money.
///
/// Before this, somebody could claim a job, collect a parcel, carry it
/// across town and hand it over with no record anywhere of having
/// earned a shilling. The gig half of dispatch was operationally real
/// and financially imaginary, and a courier's only way to know what
/// they were owed was to count deliveries themselves and hope.
///
/// The ordering here is what a courier actually wants, in order: what
/// am I owed, what did today come to, and then the statement behind
/// both. Lifetime totals sit last because nobody opens this screen to
/// ask that.
class CourierEarningsScreen extends ConsumerWidget {
  const CourierEarningsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(courierEarningsProvider);
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Your earnings'),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(courierEarningsProvider),
          child: EsokoAsyncView(
            value: view,
            isEmpty: (v) => v.earnings.deliveredTotal == 0,
            emptyMessage: "You haven't earned on a delivery yet.\n"
                'Claim a job from the Nearby tab to get started.',
            emptyIcon: Icons.payments_outlined,
            onRetry: () => ref.invalidate(courierEarningsProvider),
            data: (context, v) => _Body(view: v),
          ),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.view});
  final CourierEarningsView view;

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    final e = view.earnings;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s5),
          children: [
            // The headline is what's owed, not what's been earned all
            // time: a courier opens this to find out what is coming to
            // them, and burying that under a lifetime total would be
            // answering a question nobody asked.
            EsokoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Waiting to be paid', style: small),
                  const SizedBox(height: EsokoSpacing.s1),
                  Text(
                    'KES ${e.unpaidKes.format()}',
                    style: EsokoTypography.mono(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    'from ${e.unpaidParcels} '
                    '${e.unpaidParcels == 1 ? 'delivery' : 'deliveries'}',
                    style: small,
                  ),
                ],
              ),
            ),
            const SizedBox(height: EsokoSpacing.s3),

            Row(
              children: [
                Expanded(
                  child: EsokoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Today', style: small),
                        Text(
                          'KES ${e.earnedTodayKes.format()}',
                          style: EsokoTypography.mono(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: EsokoSpacing.s3),
                Expanded(
                  child: EsokoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Paid so far', style: small),
                        Text(
                          'KES ${e.paidKes.format()}',
                          style: EsokoTypography.mono(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: EsokoSpacing.s3),
            // The rate, in plain language. "Why is this 300?" is the
            // first question anybody asks about their own pay, and a
            // screen that can't answer it invites a phone call.
            EsokoInlineNotice(
              color: EsokoColors.navy,
              icon: EsokoIconName.info,
              message: view.tariff.describe,
            ),

            const SizedBox(height: EsokoSpacing.s5),
            EsokoSubHeader('Your deliveries'),
            const SizedBox(height: EsokoSpacing.s2),
            for (final d in view.deliveries)
              EsokoListTile(
                title: '${d.code} · KES ${d.earnedKes.format()}',
                subtitle: '${d.destinationLabel} · ${parcelHumanTime(d.deliveredAt)}',
                icon: d.paid
                    ? Icons.check_circle_outline
                    : Icons.hourglass_empty_outlined,
                trailing: SizedBox(
                  width: 72,
                  child: Text(
                    d.paid ? 'Paid' : 'Owed',
                    textAlign: TextAlign.end,
                    style: small,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
