import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../home/profile_repository.dart';
import '../shopping/order_detail_screen.dart';

final _historyProvider = FutureProvider.autoDispose<List<HistoryItem>>(
  (ref) => ref.watch(profileRepositoryProvider).myHistory(),
);

/// The "what happened" destination — GET /v1/me/history, store orders
/// and ticket bookings mixed. This used to be the last section of a
/// 608-line Settings scroll, under the loyalty-points card; it earns a
/// destination of its own for the same reason Money did — "what have I
/// done" is a question with its own shape, not a footnote on "who am
/// I".
class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(_historyProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(_historyProvider),
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
                title: 'Activity',
                subtitle: 'Every order and booking you\'ve made, in one place.',
              ),
              const SizedBox(height: EsokoSpacing.s5),
              EsokoAsyncView(
                value: history,
                isEmpty: (items) => items.isEmpty,
                emptyMessage: 'No orders or bookings yet.',
                emptyIcon: Icons.receipt_long_outlined,
                onRetry: () => ref.invalidate(_historyProvider),
                data: (context, items) => Column(
                  children: [
                    for (var i = 0; i < items.length; i++)
                      EsokoStagger(
                        index: i,
                        child: _historyTile(context, items[i]),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _historyTile(BuildContext context, HistoryItem item) {
    final icon = item.kind == 'order'
        ? Icons.storefront_outlined
        : Icons.confirmation_num_outlined;
    // Only orders have a detail screen today (pickup status, code,
    // directions) — a ticket booking's "detail" is already the Your
    // tickets segment of Tickets, so a booking tile stays informational
    // for now.
    final tappable = item.kind == 'order';
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: item.title,
        subtitle:
            '${item.status} · ${_formatDate(item.occurredAt)} · KES ${item.totalKes}',
        icon: icon,
        onTap: tappable
            ? () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => OrderDetailScreen(orderId: item.id),
                ),
              )
            : null,
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
