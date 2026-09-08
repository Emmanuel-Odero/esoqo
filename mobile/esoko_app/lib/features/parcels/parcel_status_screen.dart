import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcels_repository.dart';

final parcelStatusProvider = FutureProvider.autoDispose
    .family<ParcelStatusView?, String>(
      (ref, code) => ref.watch(parcelsRepositoryProvider).status(code),
    );

/// A parcel's own tracking page — guest-safe (see
/// dbx.GetParcelStatus), same screen a sender, a receiver, or anyone
/// they forward the code to all see identically. [deliveryCode] is
/// only ever passed in by the sender's own "Sent" list (see
/// ParcelsHubScreen) — never fetched from the server here, since the
/// public status endpoint never returns it.
class ParcelStatusScreen extends ConsumerWidget {
  const ParcelStatusScreen({super.key, required this.code, this.deliveryCode});
  final String code;
  final String? deliveryCode;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(parcelStatusProvider(code));
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Track parcel'),
      body: SafeArea(
        child: EsokoAsyncView(
          value: status,
          isEmpty: (v) => v == null,
          emptyMessage: 'That parcel code was not found.',
          emptyIcon: Icons.local_shipping_outlined,
          onRetry: () => ref.invalidate(parcelStatusProvider(code)),
          data: (context, s) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ListView(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          s!.code,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.copy_outlined),
                        tooltip: 'Copy code',
                        onPressed: () =>
                            Clipboard.setData(ClipboardData(text: s.code)),
                      ),
                    ],
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  Text('${s.originLabel} → ${s.destinationLabel}'),
                  const SizedBox(height: EsokoSpacing.s5),
                  for (var i = 0; i < parcelStatusStages.length; i++)
                    _stageRow(
                      context,
                      parcelStatusStages[i],
                      reached: i <=
                          parcelStatusStages.indexWhere(
                            (st) => st.$1 == s.status,
                          ),
                      isLast: i == parcelStatusStages.length - 1,
                    ),
                  if (deliveryCode != null) ...[
                    const SizedBox(height: EsokoSpacing.s5),
                    EsokoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Delivery code — give this to the receiver only',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: EsokoSpacing.s2),
                          Text(
                            deliveryCode!,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w800,
                              fontSize: 20,
                              letterSpacing: 2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _stageRow(
    BuildContext context,
    (String, String) stage, {
    required bool reached,
    required bool isLast,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final color = reached ? scheme.primary : Theme.of(context).textTheme.bodySmall?.color;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Icon(
              reached ? Icons.check_circle : Icons.circle_outlined,
              color: color,
              size: 20,
            ),
            if (!isLast)
              Container(width: 2, height: 28, color: color?.withValues(alpha: 0.3)),
          ],
        ),
        const SizedBox(width: EsokoSpacing.s3),
        Padding(
          padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
          child: Text(stage.$2, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }
}
