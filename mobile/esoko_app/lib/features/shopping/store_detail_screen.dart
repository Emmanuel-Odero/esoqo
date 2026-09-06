import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'category_style.dart';
import 'gradient_thumb.dart';
import 'product_detail_screen.dart';
import 'shopping_models.dart';
import 'stores_repository.dart';

final storeDetailProvider = FutureProvider.autoDispose
    .family<StoreDetail, String>(
      (ref, slug) => ref.watch(storesRepositoryProvider).detail(slug),
    );

final storeProductsProvider = FutureProvider.autoDispose
    .family<List<ProductSummary>, String>(
      (ref, slug) => ref.watch(storesRepositoryProvider).products(slug),
    );

class StoreDetailScreen extends ConsumerWidget {
  const StoreDetailScreen({super.key, required this.slug, this.tableLabel});
  final String slug;

  /// Set when arriving from a restaurant table QR — the menu opens with
  /// the table attached so the order carries it to the kitchen.
  final String? tableLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final store = ref.watch(storeDetailProvider(slug));
    final products = ref.watch(storeProductsProvider(slug));

    Future<void> refreshAll() async {
      ref.invalidate(storeDetailProvider(slug));
      ref.invalidate(storeProductsProvider(slug));
    }

    return Scaffold(
      body: EsokoAsyncView(
        value: store,
        onRetry: () => ref.invalidate(storeDetailProvider(slug)),
        data: (context, s) {
          final style = CategoryStyle.forCategory(s.primaryCategory);
          return RefreshIndicator(
            onRefresh: refreshAll,
            child: CustomScrollView(
              slivers: [
                SliverAppBar(
                  expandedHeight: 190,
                  pinned: true,
                  backgroundColor: style.gradient.last,
                  foregroundColor: Colors.white,
                  flexibleSpace: FlexibleSpaceBar(
                    // Explicit white: an explicit TextStyle without a color
                    // does NOT inherit SliverAppBar.foregroundColor here, so
                    // the title fell back to the theme's dark titleLarge and
                    // rendered near-invisible black-on-navy.
                    title: Text(
                      s.name,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                    background: Hero(
                      tag: 'store-hero-$slug',
                      child: Material(
                        color: Colors.transparent,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            GradientThumb(
                              category: s.primaryCategory,
                              iconSize: 64,
                            ),
                            DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Colors.black.withValues(alpha: 0.0),
                                    Colors.black.withValues(alpha: 0.45),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.all(EsokoSpacing.s4),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      if (tableLabel != null && tableLabel!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: EsokoSpacing.s3,
                          ),
                          child: EsokoCard(
                            child: Row(
                              children: [
                                const Icon(Icons.table_restaurant_outlined),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'Ordering for table $tableLabel — it rides along on your order.',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      if (s.tagline != null)
                        Padding(
                          // No italic: italic glyphs overhang the text box and
                          // clip at the screen edge (the cut-off "Y" in the
                          // store-hero screenshot). Muted + wrapping instead.
                          padding: const EdgeInsets.only(
                            bottom: EsokoSpacing.s2,
                            right: EsokoSpacing.s2,
                          ),
                          child: Text(
                            s.tagline!,
                            style: TextStyle(color: EsokoColors.text2),
                          ),
                        ),
                      if (s.neighborhood != null)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: EsokoSpacing.s2,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.place_outlined,
                                size: 16,
                                color: EsokoColors.text2,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  s.neighborhood!,
                                  style: TextStyle(color: EsokoColors.text2),
                                ),
                              ),
                            ],
                          ),
                        ),
                      Wrap(
                        spacing: EsokoSpacing.s2,
                        runSpacing: EsokoSpacing.s2,
                        children: [
                          if (s.primaryCategory != null)
                            EsokoStatusPill(
                              icon: Icons.sell_outlined,
                              label: s.primaryCategory!,
                              color: style.gradient.last,
                            ),
                          EsokoStatusPill(
                            icon: s.codEnabled
                                ? Icons.local_shipping_outlined
                                : Icons.phone_iphone_outlined,
                            label: s.codEnabled
                                ? 'Cash on delivery'
                                : 'Pay on order',
                            color: EsokoColors.blue,
                          ),
                        ],
                      ),
                      if (s.contactPhone != null) ...[
                        const SizedBox(height: EsokoSpacing.s4),
                        EsokoListTile(
                          title: s.contactPhone!,
                          subtitle: 'Call the store',
                          icon: Icons.phone_outlined,
                          onTap: () => launchUrl(
                            Uri.parse('tel:${s.contactPhone}'),
                            mode: LaunchMode.externalApplication,
                          ),
                        ),
                      ],
                      if (s.aboutUs != null) ...[
                        const SizedBox(height: EsokoSpacing.s4),
                        Text(
                          s.aboutUs!,
                          style: TextStyle(color: EsokoColors.text2),
                        ),
                      ],
                      const SizedBox(height: EsokoSpacing.s6),
                      EsokoAsyncView(
                        value: products,
                        isEmpty: (list) => list.isEmpty,
                        emptyMessage: 'No products listed yet.',
                        emptyIcon: Icons.inventory_2_outlined,
                        onRetry: () =>
                            ref.invalidate(storeProductsProvider(slug)),
                        data: (context, list) => Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            EsokoSubHeader('Products · ${list.length}'),
                            const SizedBox(height: EsokoSpacing.s3),
                            GridView.count(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              // Tablet-decent: three across on expanded
                              // windows, two on phones.
                              crossAxisCount:
                                  MediaQuery.sizeOf(context).width > 700
                                  ? 3
                                  : 2,
                              mainAxisSpacing: EsokoSpacing.s3,
                              crossAxisSpacing: EsokoSpacing.s3,
                              childAspectRatio: 0.72,
                              children: [
                                for (var i = 0; i < list.length; i++)
                                  EsokoStagger(
                                    index: i,
                                    child: _ProductCard(
                                      product: list[i],
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => ProductDetailScreen(
                                            productId: list[i].id,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ]),
                  ),
                ),
              ],
            ),
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
    return Semantics(
      button: true,
      label: '${product.name}, KES ${product.priceKes}',
      child: EsokoCard(
        onTap: onTap,
        padding: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 1.4,
              child: Stack(
                children: [
                  Hero(
                    tag: 'product-hero-${product.id}',
                    child: Material(
                      color: Colors.transparent,
                      child: GradientThumb(
                        category: product.category,
                        isService: product.isService,
                      ),
                    ),
                  ),
                  if (product.isService)
                    // Deliberately not EsokoStatusPill — this overlays a
                    // photo/gradient thumb, so it needs a guaranteed-opaque
                    // background for contrast, not a tinted-alpha pill.
                    Positioned(
                      top: EsokoSpacing.s2,
                      left: EsokoSpacing.s2,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.92),
                          borderRadius: BorderRadius.circular(EsokoRadius.pill),
                        ),
                        child: const Text(
                          'SERVICE',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.4,
                          ),
                        ),
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
                  Text(
                    product.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: EsokoSpacing.s1),
                  EsokoAmountText(product.priceKes, fontSize: 14),
                  if (!product.isService && product.stockQty != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        '${product.stockQty} in stock',
                        style: TextStyle(
                          fontSize: 11,
                          color: EsokoColors.text3,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
