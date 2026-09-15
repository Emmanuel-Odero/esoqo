import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'checkout_screen.dart';
import 'gradient_thumb.dart';
import 'shopping_models.dart';
import 'stores_repository.dart';

final productDetailProvider = FutureProvider.autoDispose
    .family<ProductDetail, String>(
      (ref, id) => ref.watch(storesRepositoryProvider).product(id),
    );

/// Product detail — single-item "buy now" rather than a persistent
/// multi-item cart, so the checkout flow (POST /v1/orders → STK → poll)
/// stays simple for v1. A cart can be layered on top of the same
/// /v1/orders payload (multiple `items`) later without changing the API.
class ProductDetailScreen extends ConsumerStatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final String productId;

  @override
  ConsumerState<ProductDetailScreen> createState() =>
      _ProductDetailScreenState();
}

class _ProductDetailScreenState extends ConsumerState<ProductDetailScreen> {
  int _quantity = 1;
  String? _selectedVariantId;

  @override
  Widget build(BuildContext context) {
    final product = ref.watch(productDetailProvider(widget.productId));
    // No static AppBar here — the hero image runs full-bleed to the top
    // edge, so the back button floats over a scrim instead. Without it
    // there was no visible way back (only the system gesture).
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text(''),
        leading: Padding(
          padding: const EdgeInsets.all(8),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.45),
              shape: BoxShape.circle,
            ),
            child: const BackButton(color: Colors.white),
          ),
        ),
      ),
      body: EsoqoAsyncView(
        value: product,
        onRetry: () => ref.invalidate(productDetailProvider(widget.productId)),
        data: (context, p) => Stack(
          children: [
            RefreshIndicator(
              onRefresh: () async =>
                  ref.invalidate(productDetailProvider(widget.productId)),
              child: ListView(
                padding: const EdgeInsets.only(bottom: 120),
                children: [
                  AspectRatio(
                    aspectRatio: 1.3,
                    child: Hero(
                      tag: 'product-hero-${widget.productId}',
                      child: Material(
                        color: Colors.transparent,
                        child: GradientThumb(
                          category: p.category,
                          isService: p.isService,
                          iconSize: 72,
                        ),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(EsoqoSpacing.s5),
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
                                  Text(
                                    p.name,
                                    style: Theme.of(context)
                                        .textTheme
                                        .headlineSmall,
                                  ),
                                  Row(
                                    children: [
                                      Icon(
                                        Icons.storefront_outlined,
                                        size: 14,
                                        color: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.color,
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        p.storeName,
                                        style: TextStyle(
                                          color: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.color,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            if (p.isService)
                              const EsoqoStatusPill(
                                label: 'SERVICE',
                                color: EsoqoColors.blue,
                              ),
                          ],
                        ),
                        const SizedBox(height: EsoqoSpacing.s3),
                        EsoqoAmountText(
                          '${p.priceKes}${p.unit != null ? ' / ${p.unit}' : ''}',
                          fontSize: EsoqoTypeScale.pageTitle,
                        ),
                        if (!p.isService) ...[
                          const SizedBox(height: EsoqoSpacing.s2),
                          _StockLine(product: p),
                        ],
                        if (p.description != null) ...[
                          const SizedBox(height: EsoqoSpacing.s4),
                          Text(
                            'About',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: EsoqoSpacing.s2),
                          Text(
                            p.description!,
                            style: TextStyle(
                              color: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.color,
                              height: 1.5,
                            ),
                          ),
                        ],
                        if (p.variants.isNotEmpty) ...[
                          const SizedBox(height: EsoqoSpacing.s5),
                          Text(
                            'Choose an option',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: EsoqoSpacing.s2),
                          Wrap(
                            spacing: EsoqoSpacing.s2,
                            children: [
                              for (final v in p.variants)
                                ChoiceChip(
                                  label: Text('${v.label} — KES ${v.priceKes}'),
                                  selected: _selectedVariantId == v.id,
                                  onSelected: (_) {
                                    EsoqoHaptics.tap();
                                    setState(() => _selectedVariantId = v.id);
                                  },
                                ),
                            ],
                          ),
                        ],
                        if (!p.isService && !_isOutOfStock(p)) ...[
                          const SizedBox(height: EsoqoSpacing.s5),
                          Text(
                            'Quantity',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: EsoqoSpacing.s2),
                          EsoqoStepper(
                            value: _quantity,
                            onChanged: (v) => setState(() => _quantity = v),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _BuyBar(
                totalLabel: p.isService
                    ? 'KES ${p.priceKes}'
                    : 'KES ${_lineTotal(p)}',
                buttonLabel: p.isService
                    ? 'Request this service'
                    : _isOutOfStock(p)
                    ? 'Out of stock'
                    : 'Buy now',
                enabled: p.isService || !_isOutOfStock(p),
                onBuy: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CheckoutScreen(
                      storeSlug: p.storeSlug,
                      productId: p.id,
                      variantId: _selectedVariantId,
                      quantity: p.isService ? 1 : _quantity,
                      productLabel: p.name,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _isOutOfStock(ProductDetail p) =>
      !p.isService && (p.stockQty ?? 1) <= 0 && !p.availableOnOrder;

  String _lineTotal(ProductDetail p) {
    final unit = double.tryParse(p.priceKes) ?? 0;
    return (unit * _quantity).toStringAsFixed(2);
  }
}

/// Stock availability line under the price — the model already carries
/// stockQty + availableOnOrder, but nothing surfaced them, so buyers
/// discovered stock-outs only at checkout.
class _StockLine extends StatelessWidget {
  const _StockLine({required this.product});
  final ProductDetail product;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final (label, color) = switch (product.stockQty) {
      null when product.availableOnOrder => ('Available on order', muted),
      null => ('In stock', muted),
      final q when q <= 0 && !product.availableOnOrder => (
        'Out of stock',
        scheme.error,
      ),
      final q when q <= 5 => ('Only $q left', EsoqoColors.amber),
      _ => ('In stock', muted),
    };
    return Row(
      children: [
        Icon(
          color == scheme.error
              ? Icons.highlight_off_rounded
              : Icons.check_circle_outline,
          size: 14,
          color: color,
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(color: color, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

class _BuyBar extends StatelessWidget {
  const _BuyBar({
    required this.totalLabel,
    required this.buttonLabel,
    required this.onBuy,
    this.enabled = true,
  });
  final String totalLabel;
  final String buttonLabel;
  final VoidCallback onBuy;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            EsoqoSpacing.s5,
            EsoqoSpacing.s3,
            EsoqoSpacing.s5,
            EsoqoSpacing.s3,
          ),
          child: Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Total',
                    style: TextStyle(
                      fontSize: EsoqoTypeScale.micro,
                      color: Theme.of(context).textTheme.bodySmall?.color,
                    ),
                  ),
                  EsoqoAmountText(
                    totalLabel.replaceFirst('KES ', ''),
                    fontSize: EsoqoTypeScale.subTitle,
                  ),
                ],
              ),
              const Spacer(),
              EsoqoButton.primary(
                label: buttonLabel,
                expand: false,
                onPressed: enabled ? onBuy : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
