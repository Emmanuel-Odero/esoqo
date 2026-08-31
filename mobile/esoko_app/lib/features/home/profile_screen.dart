import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../shopping/order_detail_screen.dart';

/// One history item — a store order or a ticket booking, whichever
/// GET /v1/me/history's Kind says (see dbx.HistoryItem).
class _HistoryItem {
  _HistoryItem({required this.kind, required this.id, required this.title, required this.status, required this.totalKes, required this.occurredAt});
  factory _HistoryItem.fromJson(Map<String, dynamic> json) => _HistoryItem(
        kind: json['kind'] as String,
        id: json['id'] as String,
        title: json['title'] as String,
        status: json['status'] as String,
        totalKes: json['totalKes'] as String,
        occurredAt: DateTime.tryParse(json['occurredAt'] as String? ?? '') ?? DateTime.now(),
      );
  final String kind;
  final String id;
  final String title;
  final String status;
  final String totalKes;
  final DateTime occurredAt;
}

final _historyProvider = FutureProvider.autoDispose<List<_HistoryItem>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/me/history');
  final items = (res['items'] as List?) ?? const [];
  return items.map((e) => _HistoryItem.fromJson(e as Map<String, dynamic>)).toList();
});

final _pointsProvider = FutureProvider.autoDispose<int>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/me/points');
  return res['totalPoints'] as int? ?? 0;
});

/// The "Profile" tab — real data throughout: identity + short Esoko ID
/// from GET /v1/me, purchase/booking history from GET /v1/me/history,
/// loyalty points from GET /v1/me/points. Formerly "Record"; renamed
/// because it's grown beyond a static identity view.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Center(child: CircularProgressIndicator());
    }
    final profile = auth.profile;
    final history = ref.watch(_historyProvider);
    final points = ref.watch(_pointsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_historyProvider);
        ref.invalidate(_pointsProvider);
      },
      child: ListView(
        padding: const EdgeInsets.all(EsokoSpacing.s6),
        children: [
          EsokoSectionHeader(
            title: 'Profile',
            subtitle: 'Everything Esoko holds about you — nobody else sees any of it unless you say so.',
          ),
          const SizedBox(height: EsokoSpacing.s6),

          Card(
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _row('Name', profile.displayName),
                  if (profile.msisdn != null) _row('Phone', profile.msisdn!),
                  if (profile.esokoId != null)
                    _row('Esoko ID', profile.esokoId!, mono: true, copyable: true, context: context)
                  else
                    _row('Esoko ID', 'Preparing…'),
                ],
              ),
            ),
          ),
          const SizedBox(height: EsokoSpacing.s4),

          points.when(
            data: (total) => Card(
              color: EsokoColors.greenTint,
              child: Padding(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                child: Row(
                  children: [
                    Icon(Icons.stars_rounded, color: EsokoColors.green),
                    const SizedBox(width: EsokoSpacing.s3),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('$total points', style: Theme.of(context).textTheme.titleMedium),
                        Text('Loyalty points across shops and tickets', style: TextStyle(color: EsokoColors.text2, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: EsokoSpacing.s4),
              child: LinearProgressIndicator(),
            ),
            error: (_, _) => const SizedBox.shrink(),
          ),
          const SizedBox(height: EsokoSpacing.s6),

          Text('History', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: EsokoSpacing.s3),
          EsokoAsyncView(
            value: history,
            isEmpty: (items) => items.isEmpty,
            emptyMessage: 'No orders or bookings yet.',
            emptyIcon: Icons.receipt_long_outlined,
            onRetry: () => ref.invalidate(_historyProvider),
            data: (context, items) => Column(children: [for (final item in items) _historyTile(context, item)]),
          ),

          const SizedBox(height: EsokoSpacing.s6),
          OutlinedButton(
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  Widget _historyTile(BuildContext context, _HistoryItem item) {
    final icon = item.kind == 'order' ? Icons.storefront_outlined : Icons.confirmation_num_outlined;
    // Only orders have a detail screen today (pickup status, code,
    // directions) — a ticket booking's "detail" is already the My
    // tickets tab, so a booking tile stays informational for now.
    final tappable = item.kind == 'order';
    return Card(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: ListTile(
        leading: Icon(icon, color: EsokoColors.text2),
        title: Text(item.title),
        subtitle: Text('${item.status} · ${_formatDate(item.occurredAt)}'),
        trailing: tappable
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('KES ${item.totalKes}'),
                  Icon(Icons.chevron_right_rounded, color: EsokoColors.text3),
                ],
              )
            : Text('KES ${item.totalKes}'),
        onTap: tappable
            ? () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: item.id)))
            : null,
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Widget _row(String label, String value, {bool mono = false, bool copyable = false, BuildContext? context}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s2),
      child: Row(
        children: [
          SizedBox(width: 90, child: Text(label, style: TextStyle(color: EsokoColors.text2))),
          Expanded(
            child: Text(value, style: TextStyle(fontFamily: mono ? 'monospace' : null)),
          ),
          if (copyable && context != null)
            IconButton(
              icon: const Icon(Icons.copy_outlined, size: 18),
              tooltip: 'Copy Esoko ID',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Esoko ID copied')),
                );
              },
            ),
        ],
      ),
    );
  }
}
