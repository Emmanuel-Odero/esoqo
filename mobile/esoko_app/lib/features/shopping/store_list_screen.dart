import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'shopping_models.dart';
import 'store_detail_screen.dart';

final storesProvider = FutureProvider.autoDispose<List<StoreSummary>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/stores');
  final list = (res['stores'] as List?) ?? const [];
  return list.map((e) => StoreSummary.fromJson(e as Map<String, dynamic>)).toList();
});

/// Shopping tab home — GET /v1/stores, real seeded stores (see
/// services/core-go's Go seeder) once core-go/services/core-go's stack
/// is running with `pnpm db:seed`.
class StoreListScreen extends ConsumerWidget {
  const StoreListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stores = ref.watch(storesProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(storesProvider),
      child: stores.when(
        data: (list) => list.isEmpty
            ? _empty('No stores are open yet.')
            : ListView.separated(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                itemBuilder: (context, i) {
                  final store = list[i];
                  return Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: EsokoColors.greenTint,
                        child: Text(store.name.substring(0, 1), style: TextStyle(color: EsokoColors.green)),
                      ),
                      title: Text(store.name),
                      subtitle: Text(store.tagline ?? store.primaryCategory ?? ''),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => StoreDetailScreen(slug: store.slug)),
                      ),
                    ),
                  );
                },
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _empty('Could not load stores. Pull to retry.'),
      ),
    );
  }

  Widget _empty(String message) => ListView(
        children: [
          Padding(
            padding: const EdgeInsets.all(EsokoSpacing.s8),
            child: Center(child: Text(message, style: TextStyle(color: EsokoColors.text2))),
          ),
        ],
      );
}
