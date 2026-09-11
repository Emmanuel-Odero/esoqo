import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcel_payment_screen.dart';
import 'parcel_pricing_screen.dart';
import 'parcel_receipt_confirmation_screen.dart';
import 'parcels_repository.dart';

final parcelStatusProvider = FutureProvider.autoDispose
    .family<ParcelStatusView?, String>(
      (ref, code) => ref.watch(parcelsRepositoryProvider).status(code),
    );

// Only fetched when signed in (see build()'s guard below) — a guest or
// the receiver viewing the same guest-safe screen never triggers this
// authenticated call, avoiding the app-wide "401 drops you to sign-in"
// cascade (see ApiClient._send) for someone who was never signed in to
// begin with.
final parcelHandoffHistoryProvider = FutureProvider.autoDispose
    .family<List<ParcelHandoffRow>?, String>(
      (ref, code) => ref.watch(parcelsRepositoryProvider).handoffHistory(code),
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
                          style: EsokoTypography.mono(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
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
                  const SizedBox(height: EsokoSpacing.s2),
                  // Real, per-status copy — never a bare enum label —
                  // same "who/what/next step" tone the SMS pair this
                  // status shares an event with (notify.Parcel*) uses.
                  Text(
                    parcelStatusMessage(s),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  if (s.status == 'DRAFT_PENDING_PAYMENT')
                    EsokoLoadingButton(
                      label: s.priceKes == null
                          ? 'Complete payment'
                          : 'Complete payment (KES ${s.priceKes})',
                      // Always tappable — a draft with no price chosen
                      // yet routes back into pricing first (the "edit
                      // the parcel to complete payment" step) instead
                      // of dead-ending the button; a draft that already
                      // has a price goes straight to paying it.
                      onPressed: () async {
                        if (s.priceKes == null) {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => ParcelPricingScreen(
                                code: s.code,
                                parcelType: s.parcelType,
                              ),
                            ),
                          );
                        } else {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => ParcelPaymentScreen(
                                code: s.code,
                                priceKes: double.tryParse(s.priceKes!) ?? 0,
                              ),
                            ),
                          );
                        }
                        // Either screen may have moved this draft
                        // forward (priced, or paid) — refresh so this
                        // page reflects it without a manual pull.
                        ref.invalidate(parcelStatusProvider(code));
                      },
                    )
                  else if (s.status == 'CANCELLED')
                    // No progress tracker here — it used to render
                    // every stage "unreached" (grey) under the raw
                    // "CANCELLED" string, which read as if the booking
                    // had simply never started rather than actually
                    // being stopped.
                    EsokoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Cancelled',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          if (s.cancelledAt != null) ...[
                            const SizedBox(height: EsokoSpacing.s1),
                            Text(
                              'on ${s.cancelledAt!.toLocal()}'.split('.').first,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    )
                  else
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
                  if (s.status == 'DELIVERED') ...[
                    const SizedBox(height: EsokoSpacing.s4),
                    if (s.receiptConfirmedAt != null)
                      Text(
                        'Receipt confirmed on ${s.receiptConfirmedAt!.toLocal()}'
                            .split('.')
                            .first,
                        style: Theme.of(context).textTheme.bodySmall,
                      )
                    else
                      OutlinedButton(
                        onPressed: () async {
                          final confirmed = await Navigator.of(context).push<bool>(
                            MaterialPageRoute(
                              builder: (_) =>
                                  ParcelReceiptConfirmationScreen(code: s.code),
                            ),
                          );
                          if (confirmed == true) {
                            ref.invalidate(parcelStatusProvider(code));
                          }
                        },
                        child: const Text('Confirm you received this parcel'),
                      ),
                  ],
                  if (ref.watch(authControllerProvider) is AuthSignedIn) ...[
                    const SizedBox(height: EsokoSpacing.s5),
                    _HandoffHistorySection(code: code),
                  ],
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
                            style: EsokoTypography.mono(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
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

/// The parcel_handoff log, finally surfaced somewhere — see
/// dbx.ListParcelHandoffs's own comment on it having been write-only.
/// Scoped to the parcel's own sender server-side (see
/// handleListParcelHandoffs); this section only even queries when
/// [ParcelStatusScreen] has already confirmed someone's signed in, and
/// silently disappears (rather than erroring) if the server still says
/// no — e.g. a signed-in receiver viewing someone else's parcel.
class _HandoffHistorySection extends ConsumerWidget {
  const _HandoffHistorySection({required this.code});
  final String code;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final handoffs = ref.watch(parcelHandoffHistoryProvider(code));
    return handoffs.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (rows) {
        if (rows == null || rows.isEmpty) return const SizedBox.shrink();
        return EsokoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Handling history',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: EsokoSpacing.s2),
              for (final h in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: EsokoSpacing.s1),
                  child: Text(
                    '${h.fromName ?? 'Sender'} → ${h.toName} — '
                    '${h.createdAt.toLocal()}'.split('.').first,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
