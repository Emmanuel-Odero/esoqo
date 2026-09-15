import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/esoko_tokens.dart';
import '../../../core/widgets/widgets.dart';
import '../parcels_hub_screen.dart';

/// What this rider is holding in cash right now.
class CodFloatBanner extends ConsumerWidget {
  const CodFloatBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final holding = ref.watch(codHoldingProvider);
    return holding.maybeWhen(
      data: (h) {
        if (!h.amountKes.isPositive) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.fromLTRB(
            EsokoSpacing.s4, 0, EsokoSpacing.s4, EsokoSpacing.s3,
          ),
          child: EsokoInlineNotice(
            color: EsokoColors.navy,
            icon: EsokoIconName.coins,
            message: 'You are holding KES ${h.amountKes.format()} '
                'from ${h.parcelCount} '
                '${h.parcelCount == 1 ? 'parcel' : 'parcels'}. '
                'Hand it in at the end of your round.',
          ),
        );
      },
      // A failed or pending fetch shows nothing at all: a wrong cash
      // figure on a courier's screen is worse than no figure.
      orElse: () => const SizedBox.shrink(),
    );
  }
}
