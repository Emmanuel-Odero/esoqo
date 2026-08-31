import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'category_style.dart';
import 'gradient_thumb.dart';
import 'product_detail_screen.dart';
import 'shopping_models.dart';

final storeDetailProvider = FutureProvider.autoDispose.family<StoreDetail, String>((ref, slug) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/stores/$slug');
  return StoreDetail.fromJson(res);
});

final storeProductsProvider = FutureProvider.autoDispose.family<List<ProductSummary>, String>((ref, slug) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/stores/$slug/products');
  final list = (res['products'] as List?) ?? const [];
  return list.map((e) => ProductSummary.fromJson(e as Map<String, dynamic>)).toList();
});

class StoreDetailScreen extends ConsumerWidget {
  const StoreDetailScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final store = ref.watch(storeDetailProvider(slug));
    final products = ref.watch(storeProductsProvider(slug));

    return Scaffold(
      body: EsokoAsyncView(
        value: store,
        onRetry: () => ref.invalidate(storeDetailProvider(slug)),
        data: (context, s) {
          final style = CategoryStyle.forCategory(s.primaryCategory);
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 190,
                pinned: true,
                backgroundColor: style.gradient.last,
                foregroundColor: Colors.white,
                flexibleSpace: FlexibleSpaceBar(
                  title: Text(s.name, style: const TextStyle(fontSize: 16)),
                  background: Stack(
                    fit: StackFit.expand,
                    children: [
                      GradientThumb(category: s.primaryCategory, iconSize: 64),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Colors.black.withValues(alpha: 0.0), Colors.black.withValues(alpha: 0.45)],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    if (s.tagline != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
                        child: Text(s.tagline!, style: TextStyle(color: EsokoColors.text2, fontStyle: FontStyle.italic)),
                      ),
                    Wrap(
                      spacing: EsokoSpacing.s2,
                      runSpacing: EsokoSpacing.s2,
                      children: [
                        if (s.primaryCategory != null)
                          EsokoStatusPill(icon: Icons.sell_outlined, label: s.primaryCategory!, color: style.gradient.last),
                        EsokoStatusPill(
                          icon: s.codEnabled ? Icons.local_shipping_outlined : Icons.phone_iphone_outlined,
                          label: s.codEnabled ? 'Cash on delivery' : 'Pay on order',
                          color: EsokoColors.blue,
                        ),
                      ],
                    ),
                    if (s.aboutUs != null) ...[
                      const SizedBox(height: EsokoSpacing.s4),
                      Text(s.aboutUs!, style: TextStyle(color: EsokoColors.text2)),
                    ],
                    const SizedBox(height: EsokoSpacing.s6),
                    Text('Products', style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: EsokoSpacing.s3),
                    EsokoAsyncView(
                      value: products,
                      isEmpty: (list) => list.isEmpty,
                      emptyMessage: 'No products listed yet.',
                      emptyIcon: Icons.inventory_2_outlined,
                      onRetry: () => ref.invalidate(storeProductsProvider(slug)),
                      data: (context, list) => GridView.count(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisCount: 2,
                        mainAxisSpacing: EsokoSpacing.s3,
                        crossAxisSpacing: EsokoSpacing.s3,
                        childAspectRatio: 0.72,
                        children: [
                          for (final p in list)
                            _ProductCard(
                              product: p,
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: p.id)),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ]),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap});
  final ProductSummary product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return EsokoCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1.4,
            child: Stack(
              children: [
                GradientThumb(category: product.category, isService: product.isService),
                if (product.isService)
                  // Deliberately not EsokoStatusPill — this overlays a
                  // photo/gradient thumb, so it needs a guaranteed-opaque
                  // background for contrast, not a tinted-alpha pill.
                  Positioned(
                    top: EsokoSpacing.s2,
                    left: EsokoSpacing.s2,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(EsokoRadius.pill),
                      ),
                      child: const Text('SERVICE', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(EsokoSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: EsokoSpacing.s1),
                Text('KES ${product.priceKes}', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.w700)),
                if (!product.isService && product.stockQty != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text('${product.stockQty} in stock', style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
