import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_label_screen.dart';
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
                  // A pre-printed, not-yet-booked label (see
                  // dbx.ParcelLabelStock) has no real route yet —
                  // originLabel/destinationLabel come back blank, so
                  // skip the arrow line entirely rather than show
                  // " → " with nothing on either side.
                  if (!s.preLabel) ...[
                    Text('${s.originLabel} → ${s.destinationLabel}'),
                    const SizedBox(height: EsokoSpacing.s2),
                  ],
                  // Real, per-status copy — never a bare enum label —
                  // same "who/what/next step" tone the SMS pair this
                  // status shares an event with (notify.Parcel*) uses.
                  Text(
                    parcelStatusMessage(s),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  // The delivery promise, finally shown. slaDeadlineAt
                  // has been on the parcel since it was paid for, and
                  // "when will it get here" is the single question a
                  // tracking screen exists to answer — it just had no
                  // way through to this page before.
                  if (parcelEtaText(s) != null) ...[
                    const SizedBox(height: EsokoSpacing.s2),
                    Row(
                      children: [
                        const Icon(Icons.schedule_outlined, size: 16),
                        const SizedBox(width: EsokoSpacing.s1),
                        Expanded(
                          child: Text(
                            parcelEtaText(s)!,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ],
                  // Waiting at a shop is an instruction, not a status:
                  // the receiver's next action is a walk to a specific
                  // door, so the address, hours and phone travel with it.
                  if (s.agent != null) ...[
                    const SizedBox(height: EsokoSpacing.s4),
                    _AgentCard(agent: s.agent!),
                  ],
                  const SizedBox(height: EsokoSpacing.s5),
                  if (s.status == 'DRAFT_PENDING_PAYMENT')
                    EsokoButton.primary(
                      expand: false,
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
                                priceKes: Money.tryParse(s.priceKes) ?? Money.zero,
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
                  else if (s.status == 'CANCELLED' ||
                      s.status == 'FAILED_DELIVERY' ||
                      s.status == 'HELD_AT_AGENT' ||
                      s.status == 'RETURNED_TO_SENDER')
                    // None of these are points on parcelStatusStages —
                    // they're departures from it. The tracker used to
                    // render every stage "unreached" (grey) under a raw
                    // "CANCELLED" string, which read as if the booking
                    // had never started rather than having been stopped;
                    // the same would be true, and more misleading, for a
                    // parcel that genuinely travelled and then failed at
                    // the door. They get a card that says what happened.
                    EsokoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            parcelStatusLabel(s.status),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          if (s.status == 'FAILED_DELIVERY') ...[
                            const SizedBox(height: EsokoSpacing.s1),
                            Text(
                              '${s.deliveryAttempts} '
                              '${s.deliveryAttempts == 1 ? 'attempt' : 'attempts'} so far'
                              '${s.lastAttemptAt != null ? ' · last ${parcelHumanTime(s.lastAttemptAt)}' : ''}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                          if (s.cancelledAt != null) ...[
                            const SizedBox(height: EsokoSpacing.s1),
                            Text(
                              'on ${parcelHumanTime(s.cancelledAt)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    )
                  else if (s.status == 'LABEL_PRINTED')
                    // Same reasoning as the CANCELLED branch above — a
                    // pre-printed label isn't anywhere on the real
                    // parcelStatusStages timeline (it isn't a booking
                    // at all yet), so rendering that timeline under it
                    // would just show every stage permanently
                    // unreached, reading as "stuck" rather than
                    // "hasn't started".
                    EsokoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Pre-printed label',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: EsokoSpacing.s1),
                          if (s.preLabelInfo == null)
                            Text(
                              'Not yet attached to a shipment.',
                              style: Theme.of(context).textTheme.bodyMedium,
                            )
                          else ...[
                            Text(
                              s.preLabelInfo!.itemDescription,
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                            if (s.preLabelInfo!.destination != null)
                              _labelInfoRow('Destination', s.preLabelInfo!.destination!),
                            if (s.preLabelInfo!.ownerName != null)
                              _labelInfoRow('Owner', s.preLabelInfo!.ownerName!),
                            if (s.preLabelInfo!.ownerContact != null)
                              _labelInfoRow('Contact', s.preLabelInfo!.ownerContact!),
                            if (s.preLabelInfo!.ownerGender != null)
                              _labelInfoRow('Gender', s.preLabelInfo!.ownerGender!),
                            if (s.preLabelInfo!.itemType != null)
                              _labelInfoRow('Item type', s.preLabelInfo!.itemType!),
                            if (s.preLabelInfo!.weightRangeKg != null)
                              _labelInfoRow('Weight', s.preLabelInfo!.weightRangeKg!),
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
                    // The evidence half of a delivery — what turns "it
                    // says delivered but I never got it" from an
                    // argument into a question with an answer.
                    if (s.podReceivedByName != null) ...[
                      const SizedBox(height: EsokoSpacing.s4),
                      EsokoCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Proof of delivery',
                              style: TextStyle(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: EsokoSpacing.s1),
                            Text(
                              'Received by ${s.podReceivedByName}'
                              '${s.podMethod == 'AGENT_COLLECTION' ? ' at the pickup point' : ''}',
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: EsokoSpacing.s4),
                    if (s.receiptConfirmedAt != null)
                      Text(
                        'Receipt confirmed ${parcelHumanTime(s.receiptConfirmedAt)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      )
                    else
                      EsokoButton.secondary(
                        label: 'Confirm you received this parcel',
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
                      ),
                  ],
                  if (ref.watch(authControllerProvider) is AuthSignedIn) ...[
                    const SizedBox(height: EsokoSpacing.s5),
                    _HandoffHistorySection(code: code),
                    // Scanning a parcel used to mean "click through to
                    // Print label just to see who it's for" — this
                    // surfaces that same info (server-gated: silently
                    // shows nothing for a signed-in visitor who isn't
                    // this parcel's handler/dispatch staff, same
                    // IsParcelHandler check the label screen and print
                    // button both already rely on) right on the scan
                    // result itself.
                    _LabelInfoSection(code: s.code),
                    const SizedBox(height: EsokoSpacing.s4),
                    EsokoButton.secondary(
                      label: 'Print label',
                      icon: Icons.qr_code_2_outlined,
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ParcelLabelScreen(code: s.code),
                        ),
                      ),
                    ),
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

  Widget _labelInfoRow(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: EsokoSpacing.s1),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 90,
          child: Text(label, style: const TextStyle(color: EsokoColors.line)),
        ),
        Expanded(child: Text(value)),
      ],
    ),
  );

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

/// Where to collect a parcel that's on a pickup point's shelf.
///
/// A status of "waiting at a pickup point" is useless on its own: the
/// receiver's next action is a walk to a specific door, so the address,
/// the hours and a phone number belong in the same card — along with
/// the two things they'll actually tap, a call and directions.
class _AgentCard extends StatelessWidget {
  const _AgentCard({required this.agent});
  final ParcelAgentStop agent;

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Collect from', style: small),
          const SizedBox(height: EsokoSpacing.s1),
          Text(agent.name, style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(agent.locationHint, style: small),
          if (agent.openingHours != null)
            Text('Open ${agent.openingHours}', style: small),
          if (agent.holdingFeeKes.isPositive)
            Text(
              'KES ${agent.holdingFeeKes.format()} collection fee, '
              'payable at the shop',
              style: small,
            ),
          const SizedBox(height: EsokoSpacing.s2),
          Row(
            children: [
              if (agent.msisdn.isNotEmpty)
                Expanded(
                  child: EsokoButton.secondary(
                    label: 'Call',
                    icon: Icons.phone_outlined,
                    onPressed: () =>
                        launchUrl(Uri.parse('tel:${agent.msisdn}')),
                  ),
                ),
              if (agent.msisdn.isNotEmpty) const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: EsokoButton.secondary(
                  label: 'Directions',
                  icon: Icons.map_outlined,
                  onPressed: () => launchUrl(
                    Uri.parse(
                      'https://www.google.com/maps/search/?api=1'
                      '&query=${agent.lat},${agent.lng}',
                    ),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
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
      error: (_, _) => const SizedBox.shrink(),
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
                    '${parcelHumanTime(h.createdAt)}',
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

/// What a handler/courier actually needs after a scan — weight,
/// receiver, phone-last-4 — without clicking through to the print
/// screen just to see it (see this section's own call site comment).
/// Same PII-minimal fields the printed label itself no longer even
/// carries (see ParcelLabelScreen's own comment on why those moved
/// off paper and behind a scan instead) — this *is* that "behind a
/// scan" surface. Silently disappears on a 403 (a signed-in visitor
/// who isn't this parcel's handler/dispatch staff) rather than
/// erroring — same graceful-hide _HandoffHistorySection follows.
class _LabelInfoSection extends ConsumerWidget {
  const _LabelInfoSection({required this.code});
  final String code;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = ref.watch(parcelLabelProvider(code));
    return label.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (l) => Padding(
        padding: const EdgeInsets.only(top: EsokoSpacing.s4),
        child: EsokoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Handling info', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: EsokoSpacing.s2),
              Text('${parcelTypeLabel(l.parcelType)}'
                  '${l.weightKg != null ? ' · ${l.weightKg!.toStringAsFixed(1)} kg' : ''}'),
              Text('Receiver: ${l.receiverName}'
                  '${l.receiverPhoneLast4.isNotEmpty ? ' (…${l.receiverPhoneLast4})' : ''}'),
              // The whole point of capturing a pin: a courier holding
              // this parcel gets one tap into their maps app instead of
              // phoning the receiver for directions, which is what the
              // free-text label alone forces and what this market's
              // delivery-failure rate is largely made of.
              if (l.hasDestinationPin) ...[
                const SizedBox(height: EsokoSpacing.s2),
                EsokoButton.secondary(
                  label: 'Navigate to the drop-off',
                  icon: Icons.navigation_outlined,
                  onPressed: () => launchUrl(
                    Uri.parse(
                      'https://www.google.com/maps/search/?api=1'
                      '&query=${l.destinationLat},${l.destinationLng}',
                    ),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
