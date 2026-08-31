import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
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
      appBar: AppBar(title: Text(store.valueOrNull?.name ?? 'Store')),
      body: store.when(
        data: (s) => ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s4),
          children: [
            if (s.tagline != null) Text(s.tagline!, style: TextStyle(color: EsokoColors.text2)),
            if (s.aboutUs != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              Text(s.aboutUs!),
            ],
            const SizedBox(height: EsokoSpacing.s5),
            Text('Products', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: EsokoSpacing.s3),
            products.when(
              data: (list) => list.isEmpty
                  ? Text('No products listed yet.', style: TextStyle(color: EsokoColors.text2))
                  : GridView.count(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 2,
                      mainAxisSpacing: EsokoSpacing.s3,
                      crossAxisSpacing: EsokoSpacing.s3,
                      childAspectRatio: 0.85,
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
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Text('Could not load products.', style: TextStyle(color: EsokoColors.red)),
            ),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load that store.', style: TextStyle(color: EsokoColors.red))),
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
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Center(
                  child: Icon(
                    product.isService ? Icons.handyman_outlined : Icons.inventory_2_outlined,
                    size: 36,
                    color: EsokoColors.text3,
                  ),
                ),
              ),
              Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: EsokoSpacing.s1),
              Text('KES ${product.priceKes}', style: TextStyle(color: EsokoColors.green)),
              if (product.isService)
                Text('Order on request', style: TextStyle(fontSize: 11, color: EsokoColors.text3))
              else if (product.stockQty != null)
                Text('${product.stockQty} in stock', style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
            ],
          ),
        ),
      ),
    );
  }
}
