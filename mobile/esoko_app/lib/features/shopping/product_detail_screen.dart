import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'checkout_screen.dart';
import 'gradient_thumb.dart';
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
      body: EsokoAsyncView(
        value: product,
        onRetry: () => ref.invalidate(productDetailProvider(widget.productId)),
        data: (context, p) => Stack(
          children: [
            ListView(
              padding: const EdgeInsets.only(bottom: 120),
              children: [
                AspectRatio(
                  aspectRatio: 1.3,
                  child: GradientThumb(category: p.category, isService: p.isService, iconSize: 72),
                ),
                Padding(
                  padding: const EdgeInsets.all(EsokoSpacing.s5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(p.name, style: Theme.of(context).textTheme.headlineSmall),
                                Row(
                                  children: [
                                    Icon(Icons.storefront_outlined, size: 14, color: EsokoColors.text3),
                                    const SizedBox(width: 4),
                                    Text(p.storeName, style: TextStyle(color: EsokoColors.text2)),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          if (p.isService) const EsokoStatusPill(label: 'SERVICE', color: EsokoColors.blue),
                        ],
                      ),
                      const SizedBox(height: EsokoSpacing.s3),
                      Text('KES ${p.priceKes}${p.unit != null ? ' / ${p.unit}' : ''}',
                          style: TextStyle(color: EsokoColors.green, fontSize: 26, fontWeight: FontWeight.bold)),
                      if (p.description != null) ...[
                        const SizedBox(height: EsokoSpacing.s4),
                        Text('About', style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: EsokoSpacing.s2),
                        Text(p.description!, style: TextStyle(color: EsokoColors.text2, height: 1.5)),
                      ],
                      if (p.variants.isNotEmpty) ...[
                        const SizedBox(height: EsokoSpacing.s5),
                        Text('Choose an option', style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: EsokoSpacing.s2),
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
                      if (!p.isService) ...[
                        const SizedBox(height: EsokoSpacing.s5),
                        Text('Quantity', style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: EsokoSpacing.s2),
                        _QuantityStepper(
                          quantity: _quantity,
                          onDecrement: _quantity > 1 ? () => setState(() => _quantity--) : null,
                          onIncrement: () => setState(() => _quantity++),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _BuyBar(
                totalLabel: p.isService ? 'KES ${p.priceKes}' : 'KES ${_lineTotal(p)}',
                buttonLabel: p.isService ? 'Request this service' : 'Buy now',
                onBuy: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => CheckoutScreen(
                    storeSlug: p.storeSlug,
                    productId: p.id,
                    variantId: _selectedVariantId,
                    quantity: p.isService ? 1 : _quantity,
                    productLabel: p.name,
                  ),
                )),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _lineTotal(ProductDetail p) {
    final unit = double.tryParse(p.priceKes) ?? 0;
    return (unit * _quantity).toStringAsFixed(2);
  }
}

class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({required this.quantity, required this.onDecrement, required this.onIncrement});
  final int quantity;
  final VoidCallback? onDecrement;
  final VoidCallback onIncrement;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(border: Border.all(color: EsokoColors.line), borderRadius: BorderRadius.circular(EsokoRadius.pill)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(onPressed: onDecrement, icon: const Icon(Icons.remove)),
          SizedBox(width: 28, child: Text('$quantity', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
          IconButton(onPressed: onIncrement, icon: const Icon(Icons.add)),
        ],
      ),
    );
  }
}

class _BuyBar extends StatelessWidget {
  const _BuyBar({required this.totalLabel, required this.buttonLabel, required this.onBuy});
  final String totalLabel;
  final String buttonLabel;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 12, offset: const Offset(0, -2))],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s3, EsokoSpacing.s5, EsokoSpacing.s3),
          child: Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Total', style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
                  Text(totalLabel, style: TextStyle(fontWeight: FontWeight.w800, color: EsokoColors.green, fontSize: 16)),
                ],
              ),
              const Spacer(),
              FilledButton(onPressed: onBuy, child: Text(buttonLabel)),
            ],
          ),
        ),
      ),
    );
  }
}
