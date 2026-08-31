import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'checkout_screen.dart';
import 'shopping_models.dart';

final productDetailProvider = FutureProvider.autoDispose.family<ProductDetail, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/products/$id');
  return ProductDetail.fromJson(res);
});

/// Product detail — single-item "buy now" rather than a persistent
/// multi-item cart, so the checkout flow (POST /v1/orders → STK → poll)
/// stays simple for v1. A cart can be layered on top of the same
/// /v1/orders payload (multiple `items`) later without changing the API.
class ProductDetailScreen extends ConsumerStatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final String productId;

  @override
  ConsumerState<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends ConsumerState<ProductDetailScreen> {
  int _quantity = 1;
  String? _selectedVariantId;

  @override
  Widget build(BuildContext context) {
    final product = ref.watch(productDetailProvider(widget.productId));
    return Scaffold(
      appBar: AppBar(title: const Text('Product')),
      body: product.when(
        data: (p) => Padding(
          padding: const EdgeInsets.all(EsokoSpacing.s5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(p.isService ? Icons.handyman_outlined : Icons.inventory_2_outlined, size: 64, color: EsokoColors.text3),
              const SizedBox(height: EsokoSpacing.s4),
              Text(p.name, style: Theme.of(context).textTheme.headlineSmall),
              Text('from ${p.storeName}', style: TextStyle(color: EsokoColors.text2)),
              const SizedBox(height: EsokoSpacing.s3),
              Text('KES ${p.priceKes}${p.unit != null ? ' / ${p.unit}' : ''}',
                  style: TextStyle(color: EsokoColors.green, fontSize: 20, fontWeight: FontWeight.bold)),
              if (p.description != null) ...[
                const SizedBox(height: EsokoSpacing.s3),
                Text(p.description!),
              ],
              if (p.variants.isNotEmpty) ...[
                const SizedBox(height: EsokoSpacing.s4),
                Text('Choose an option', style: Theme.of(context).textTheme.titleSmall),
                Wrap(
                  spacing: EsokoSpacing.s2,
                  children: [
                    for (final v in p.variants)
                      ChoiceChip(
                        label: Text('${v.label} — KES ${v.priceKes}'),
                        selected: _selectedVariantId == v.id,
                        onSelected: (_) => setState(() => _selectedVariantId = v.id),
                      ),
                  ],
                ),
              ],
              const Spacer(),
              if (!p.isService) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    Text('$_quantity', style: Theme.of(context).textTheme.titleMedium),
                    IconButton(
                      onPressed: () => setState(() => _quantity++),
                      icon: const Icon(Icons.add_circle_outline),
                    ),
                  ],
                ),
              ],
              FilledButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => CheckoutScreen(
                    storeSlug: p.storeSlug,
                    productId: p.id,
                    variantId: _selectedVariantId,
                    quantity: p.isService ? 1 : _quantity,
                    productLabel: p.name,
                  ),
                )),
                child: Text(p.isService ? 'Request this service' : 'Buy now'),
              ),
            ],
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load that product.', style: TextStyle(color: EsokoColors.red))),
      ),
    );
  }
}
