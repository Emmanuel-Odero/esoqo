import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'shopping_models.dart';
import 'stores_repository.dart';

final orderDetailProvider = FutureProvider.autoDispose
    .family<OrderStatus, String>(
      (ref, orderId) => ref.watch(storesRepositoryProvider).order(orderId),
    );

/// One order's status — placed, paid, ready for pickup (with the
/// collection code), or already collected. GET /v1/orders/:id is
/// public-by-id (see core-go's own comment on handleGetOrder), same
/// trust model the rest of the buyer API uses, so this screen works
/// whether reached from a signed-in history list or a raw order link.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final order = ref.watch(orderDetailProvider(orderId));
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Order'),
      body: SafeArea(
        child: EsokoAsyncView(
          value: order,
          onRetry: () => ref.invalidate(orderDetailProvider(orderId)),
          data: (context, o) => _body(context, ref, o),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, OrderStatus o) {
    if (o.status == 'CANCELLED') {
      return _cancelled(context, o);
    }
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(orderDetailProvider(orderId)),
      child: ListView(
        padding: const EdgeInsets.all(EsokoSpacing.s5),
        children: [
          EsokoAdaptiveBody(
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  o.storeName,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: EsokoSpacing.s1),
                Text(
                  'KES ${o.totalKes} · placed ${_formatDate(o.createdAt)}',
                  style: TextStyle(
                    color: Theme.of(context).textTheme.bodySmall?.color,
                  ),
                ),
                const SizedBox(height: EsokoSpacing.s6),
                if (o.isDineIn)
                  _dineInStatus(context, ref, o)
                else if (o.isPickup)
                  _timeline(context, o)
                else
                  _deliveryStatus(context, o),
                if (o.isPickup &&
                    (o.status == 'READY_FOR_PICKUP' ||
                        o.status == 'FULFILLED')) ...[
                  const SizedBox(height: EsokoSpacing.s6),
                  _pickupCodeCard(context, o),
                ],
                if (o.isPickup && o.storeNeighborhood != null) ...[
                  const SizedBox(height: EsokoSpacing.s5),
                  _directionsCard(context, o),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _cancelled(BuildContext context, OrderStatus o) {
    return const EsokoEmptyState(
      icon: Icons.cancel_outlined,
      message: 'This order was cancelled.',
    );
  }

  static const _pickupStages = [
    (
      status: 'PENDING_PAYMENT',
      label: 'Placed',
      icon: Icons.receipt_long_outlined,
    ),
    (status: 'PAID', label: 'Paid', icon: Icons.check_circle_outline),
    (
      status: 'READY_FOR_PICKUP',
      label: 'Ready for pickup',
      icon: Icons.storefront_outlined,
    ),
    (status: 'FULFILLED', label: 'Collected', icon: Icons.task_alt_rounded),
  ];

  Widget _timeline(BuildContext context, OrderStatus o) {
    final currentIndex = _pickupStages.indexWhere((s) => s.status == o.status);
    return Column(
      children: [
        for (var i = 0; i < _pickupStages.length; i++) ...[
          _timelineRow(
            context,
            _pickupStages[i],
            reached: i <= currentIndex,
            isLast: i == _pickupStages.length - 1,
          ),
        ],
      ],
    );
  }

  Widget _timelineRow(
    BuildContext context,
    ({String status, String label, IconData icon}) stage, {
    required bool reached,
    required bool isLast,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final color = reached ? scheme.primary : muted;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                // Alpha wash of primary / the theme's own surface, not
                // fixed EsokoColors.greenTint/.paper — those two were
                // both tuned for a light scaffold and stuck out as
                // bright patches once the background flipped dark.
                color: reached
                    ? scheme.primary.withValues(alpha: isDark ? 0.20 : 0.12)
                    : Theme.of(context).colorScheme.surfaceContainerHighest,
                shape: BoxShape.circle,
                border: Border.all(
                  color: color ?? EsokoColors.line,
                  width: 1.5,
                ),
              ),
              child: Icon(stage.icon, size: 16, color: color),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 32,
                color: reached ? scheme.primary : EsokoColors.line,
              ),
          ],
        ),
        const SizedBox(width: EsokoSpacing.s3),
        Padding(
          padding: const EdgeInsets.only(top: EsokoSpacing.s2),
          child: Text(
            stage.label,
            style: TextStyle(
              color: reached ? null : muted,
              fontWeight: reached ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  static const _dineInStages = [
    (status: 'ORDERED', label: 'Sent to the kitchen', icon: Icons.receipt_long_outlined),
    (status: 'PREPARING', label: 'Preparing', icon: Icons.soup_kitchen_outlined),
    (status: 'SERVED', label: 'Served', icon: Icons.room_service_outlined),
    (status: 'PAYING', label: 'Paying', icon: Icons.payments_outlined),
    (status: 'CLOSED', label: 'Closed', icon: Icons.check_circle_outline),
  ];

  /// A diner's own view of their table — the same timeline treatment
  /// as pickup's own _timeline, plus a tip once there's someone to
  /// credit it to (SERVED or later, matching when a real table would
  /// actually be settling up).
  Widget _dineInStatus(BuildContext context, WidgetRef ref, OrderStatus o) {
    final currentIndex = _dineInStages.indexWhere((s) => s.status == o.dineInStatus);
    final canTip = currentIndex >= _dineInStages.indexWhere((s) => s.status == 'SERVED');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Table ${o.tableLabel}',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
        ),
        const SizedBox(height: EsokoSpacing.s4),
        for (var i = 0; i < _dineInStages.length; i++)
          _timelineRow(
            context,
            _dineInStages[i],
            reached: i <= currentIndex,
            isLast: i == _dineInStages.length - 1,
          ),
        if (canTip) ...[
          const SizedBox(height: EsokoSpacing.s4),
          _TipButton(orderId: o.id, existingTipKes: o.tipKes),
        ],
      ],
    );
  }

  Widget _deliveryStatus(BuildContext context, OrderStatus o) {
    final label = switch (o.status) {
      'PENDING_PAYMENT' => 'Awaiting payment',
      'PAID' => 'Paid — preparing for delivery',
      'FULFILLED' => 'Delivered',
      _ => o.status,
    };
    return Row(
      children: [
        Icon(
          Icons.local_shipping_outlined,
          color: Theme.of(context).textTheme.bodySmall?.color,
        ),
        const SizedBox(width: EsokoSpacing.s3),
        Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
    );
  }

  Widget _pickupCodeCard(BuildContext context, OrderStatus o) {
    final ready = o.status == 'READY_FOR_PICKUP';
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      decoration: BoxDecoration(
        // Alpha wash of primary / the theme's own surface, not fixed
        // EsokoColors.greenTint/.paper (see _timelineRow's identical fix).
        color: ready
            ? scheme.primary.withValues(alpha: isDark ? 0.20 : 0.12)
            : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(EsokoRadius.lg),
        border: Border.all(color: ready ? scheme.primary : EsokoColors.line),
      ),
      child: Column(
        children: [
          Text(
            ready
                ? 'Your order is ready — show this code at the counter'
                : 'Collected with code',
            textAlign: TextAlign.center,
            style: TextStyle(color: muted, fontSize: 13),
          ),
          const SizedBox(height: EsokoSpacing.s3),
          GestureDetector(
            onTap: () {
              EsokoHaptics.confirm();
              Clipboard.setData(ClipboardData(text: o.pickupCode ?? ''));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pickup code copied')),
              );
            },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  o.pickupCode ?? '',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2,
                  ),
                ),
                const SizedBox(width: EsokoSpacing.s2),
                Icon(Icons.copy_outlined, size: 18, color: muted),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _directionsCard(BuildContext context, OrderStatus o) {
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Row(
      children: [
        Icon(Icons.place_outlined, color: muted),
        const SizedBox(width: EsokoSpacing.s3),
        Expanded(
          child: Text(o.storeNeighborhood!, style: TextStyle(color: muted)),
        ),
        if (o.storeLatitude != null && o.storeLongitude != null)
          EsokoButton.tertiary(
            label: 'Directions',
            icon: Icons.directions_outlined,
            onPressed: () =>
                _openDirections(o.storeLatitude!, o.storeLongitude!),
          ),
      ],
    );
  }

  Future<void> _openDirections(String lat, String lng) async {
    final uri = Uri.parse('https://maps.apple.com/?daddr=$lat,$lng');
    final fallback = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng',
    );
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      await launchUrl(fallback, mode: LaunchMode.externalApplication);
    }
  }

  String _formatDate(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

/// A tip, added once — reuses the same "one KES amount, entered fast"
/// dialog as the tout's cash tally (Phase 2) and an instalment top-up
/// (Phase 4). Guest-safe: the order id is the trust boundary here (see
/// dbx.AddTip's own comment), same as every other buyer-facing action
/// on this screen.
class _TipButton extends ConsumerStatefulWidget {
  const _TipButton({required this.orderId, this.existingTipKes});
  final String orderId;
  final String? existingTipKes;

  @override
  ConsumerState<_TipButton> createState() => _TipButtonState();
}

class _TipButtonState extends ConsumerState<_TipButton> {
  bool _busy = false;
  String? _tipKes;

  @override
  void initState() {
    super.initState();
    _tipKes = widget.existingTipKes;
  }

  Future<void> _addTip() async {
    final amount = await showAmountDialog(context, title: 'Add a tip');
    if (amount == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(storesRepositoryProvider).addTip(
            orderId: widget.orderId,
            tipKes: amount,
          );
      setState(() => _tipKes = amount.toStringAsFixed(2));
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_tipKes != null) {
      return Row(
        children: [
          const Icon(Icons.volunteer_activism_outlined, size: 18, color: EsokoColors.green),
          const SizedBox(width: 8),
          Text('KES $_tipKes tip added — thank you', style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      );
    }
    return EsokoButton.secondary(
      label: 'Add a tip',
      icon: Icons.volunteer_activism_outlined,
      loading: _busy,
      onPressed: _addTip,
    );
  }
}
