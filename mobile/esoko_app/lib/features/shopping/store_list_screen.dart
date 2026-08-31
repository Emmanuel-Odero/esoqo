import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'category_style.dart';
import 'gradient_thumb.dart';
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
            ? _EmptyState(message: 'No stores are open yet.')
            : CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Shop the market', style: Theme.of(context).textTheme.headlineSmall),
                          const SizedBox(height: EsokoSpacing.s1),
                          Text(
                            'Goods, produce and services from stores across Esoko.',
                            style: TextStyle(color: EsokoColors.text2),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(EsokoSpacing.s4, EsokoSpacing.s2, EsokoSpacing.s4, EsokoSpacing.s6),
                    sliver: SliverList.separated(
                      itemCount: list.length,
                      separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                      itemBuilder: (context, i) => _StoreCard(store: list[i]),
                    ),
                  ),
                ],
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _EmptyState(message: 'Could not load stores. Pull to retry.'),
      ),
    );
  }
}

class _StoreCard extends StatelessWidget {
  const _StoreCard({required this.store});
  final StoreSummary store;

  @override
  Widget build(BuildContext context) {
    final style = CategoryStyle.forCategory(store.primaryCategory);
    return Material(
      color: Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => StoreDetailScreen(slug: store.slug)),
        ),
        child: Container(
          decoration: BoxDecoration(border: Border.all(color: EsokoColors.line)),
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 64,
                height: 64,
                child: GradientThumb(
                  category: store.primaryCategory,
                  borderRadius: BorderRadius.circular(EsokoRadius.md),
                  iconSize: 28,
                ),
              ),
              const SizedBox(width: EsokoSpacing.s4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(store.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: EsokoSpacing.s1),
                    if (store.tagline != null)
                      Text(store.tagline!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: EsokoColors.text2)),
                    const SizedBox(height: EsokoSpacing.s2),
                    if (store.primaryCategory != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s2, vertical: 3),
                        decoration: BoxDecoration(
                          color: style.gradient.last.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(EsokoRadius.pill),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(style.icon, size: 12, color: style.gradient.last),
                            const SizedBox(width: 4),
                            Text(store.primaryCategory!, style: TextStyle(fontSize: 11, color: style.gradient.last, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: EsokoColors.text3),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.all(EsokoSpacing.s8),
          child: Column(
            children: [
              Icon(Icons.storefront_outlined, size: 40, color: EsokoColors.text3),
              const SizedBox(height: EsokoSpacing.s3),
              Center(child: Text(message, style: TextStyle(color: EsokoColors.text2))),
            ],
          ),
        ),
      ],
    );
  }
}
