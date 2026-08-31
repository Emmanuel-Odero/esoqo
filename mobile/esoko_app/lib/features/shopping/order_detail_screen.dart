import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'shopping_models.dart';

final orderDetailProvider = FutureProvider.autoDispose.family<OrderStatus, String>((ref, orderId) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/orders/$orderId');
  return OrderStatus.fromJson(res);
});

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
          Text(o.storeName, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: EsokoSpacing.s1),
          Text('KES ${o.totalKes} · placed ${_formatDate(o.createdAt)}', style: TextStyle(color: EsokoColors.text2)),
          const SizedBox(height: EsokoSpacing.s6),
          if (o.isPickup) _timeline(o) else _deliveryStatus(o),
          if (o.isPickup && (o.status == 'READY_FOR_PICKUP' || o.status == 'FULFILLED')) ...[
            const SizedBox(height: EsokoSpacing.s6),
            _pickupCodeCard(context, o),
          ],
          if (o.isPickup && o.storeNeighborhood != null) ...[
            const SizedBox(height: EsokoSpacing.s5),
            _directionsCard(o),
          ],
        ],
      ),
    );
  }

  Widget _cancelled(BuildContext context, OrderStatus o) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cancel_outlined, size: 40, color: EsokoColors.text3),
            const SizedBox(height: EsokoSpacing.s3),
            Text('This order was cancelled.', style: TextStyle(color: EsokoColors.text2)),
          ],
        ),
      ),
    );
  }

  static const _pickupStages = [
    (status: 'PENDING_PAYMENT', label: 'Placed', icon: Icons.receipt_long_outlined),
    (status: 'PAID', label: 'Paid', icon: Icons.check_circle_outline),
    (status: 'READY_FOR_PICKUP', label: 'Ready for pickup', icon: Icons.storefront_outlined),
    (status: 'FULFILLED', label: 'Collected', icon: Icons.task_alt_rounded),
  ];

  Widget _timeline(OrderStatus o) {
    final currentIndex = _pickupStages.indexWhere((s) => s.status == o.status);
    return Column(
      children: [
        for (var i = 0; i < _pickupStages.length; i++) ...[
          _timelineRow(_pickupStages[i], reached: i <= currentIndex, isLast: i == _pickupStages.length - 1),
        ],
      ],
    );
  }

  Widget _timelineRow(({String status, String label, IconData icon}) stage, {required bool reached, required bool isLast}) {
    final color = reached ? EsokoColors.green : EsokoColors.text3;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: reached ? EsokoColors.greenTint : EsokoColors.paper,
                shape: BoxShape.circle,
                border: Border.all(color: color, width: 1.5),
              ),
              child: Icon(stage.icon, size: 16, color: color),
            ),
            if (!isLast) Container(width: 2, height: 32, color: reached ? EsokoColors.green : EsokoColors.line),
          ],
        ),
        const SizedBox(width: EsokoSpacing.s3),
        Padding(
          padding: const EdgeInsets.only(top: EsokoSpacing.s2),
          child: Text(
            stage.label,
            style: TextStyle(color: reached ? EsokoColors.text : EsokoColors.text3, fontWeight: reached ? FontWeight.w700 : FontWeight.w500),
          ),
        ),
      ],
    );
  }

  Widget _deliveryStatus(OrderStatus o) {
    final label = switch (o.status) {
      'PENDING_PAYMENT' => 'Awaiting payment',
      'PAID' => 'Paid — preparing for delivery',
      'FULFILLED' => 'Delivered',
      _ => o.status,
    };
    return Row(
      children: [
        Icon(Icons.local_shipping_outlined, color: EsokoColors.text2),
        const SizedBox(width: EsokoSpacing.s3),
        Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
    );
  }

  Widget _pickupCodeCard(BuildContext context, OrderStatus o) {
    final ready = o.status == 'READY_FOR_PICKUP';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      decoration: BoxDecoration(
        color: ready ? EsokoColors.greenTint : EsokoColors.paper,
        borderRadius: BorderRadius.circular(EsokoRadius.lg),
        border: Border.all(color: ready ? EsokoColors.green : EsokoColors.line),
      ),
      child: Column(
        children: [
          Text(
            ready ? 'Your order is ready — show this code at the counter' : 'Collected with code',
            textAlign: TextAlign.center,
            style: TextStyle(color: EsokoColors.text2, fontSize: 13),
          ),
          const SizedBox(height: EsokoSpacing.s3),
          GestureDetector(
            onTap: () {
              Clipboard.setData(ClipboardData(text: o.pickupCode ?? ''));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pickup code copied')));
            },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  o.pickupCode ?? '',
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 2),
                ),
                const SizedBox(width: EsokoSpacing.s2),
                Icon(Icons.copy_outlined, size: 18, color: EsokoColors.text3),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _directionsCard(OrderStatus o) {
    return Row(
      children: [
        Icon(Icons.place_outlined, color: EsokoColors.text2),
        const SizedBox(width: EsokoSpacing.s3),
        Expanded(child: Text(o.storeNeighborhood!, style: TextStyle(color: EsokoColors.text2))),
        if (o.storeLatitude != null && o.storeLongitude != null)
          TextButton.icon(
            onPressed: () => _openDirections(o.storeLatitude!, o.storeLongitude!),
            icon: const Icon(Icons.directions_outlined, size: 18),
            label: const Text('Directions'),
          ),
      ],
    );
  }

  Future<void> _openDirections(String lat, String lng) async {
    final uri = Uri.parse('https://maps.apple.com/?daddr=$lat,$lng');
    final fallback = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');
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
