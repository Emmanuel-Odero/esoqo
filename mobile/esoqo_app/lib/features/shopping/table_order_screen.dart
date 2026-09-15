import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'order_detail_screen.dart';
import 'shopping_models.dart';
import 'stores_repository.dart';

/// A table's basket — quantity per product id, scoped to one store
/// visit. Deliberately separate from any general shopping-cart concept
/// (the app has none): this exists only for the length of one dine-in
/// order, cleared once it's sent to the kitchen, and never persisted —
/// same "nothing reserved until it's actually placed" principle
/// dbx.OpenInstallmentPlan already uses elsewhere.
class TableCartController extends Notifier<Map<String, int>> {
  @override
  Map<String, int> build() => const {};

  void add(String productId) {
    state = {...state, productId: (state[productId] ?? 0) + 1};
  }

  void setQuantity(String productId, int quantity) {
    final next = {...state};
    if (quantity <= 0) {
      next.remove(productId);
    } else {
      next[productId] = quantity;
    }
    state = next;
  }

  void clear() => state = const {};
}

final tableCartProvider =
    NotifierProvider<TableCartController, Map<String, int>>(
      TableCartController.new,
    );

/// The floating bar StoreDetailScreen shows once the table cart has
/// anything in it — count, running total, "Review order".
class TableCartBar extends ConsumerWidget {
  const TableCartBar({
    super.key,
    required this.storeSlug,
    required this.tableLabel,
    required this.products,
  });

  final String storeSlug;
  final String tableLabel;
  final List<ProductSummary> products;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(tableCartProvider);
    if (cart.isEmpty) return const SizedBox.shrink();
    final byId = {for (final p in products) p.id: p};
    var count = 0;
    var total = 0.0;
    for (final entry in cart.entries) {
      count += entry.value;
      final price = double.tryParse(byId[entry.key]?.priceKes ?? '0') ?? 0;
      total += price * entry.value;
    }
    return SafeArea(
      minimum: const EdgeInsets.all(EsokoSpacing.s4),
      child: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(EsokoRadius.pill),
        color: Theme.of(context).colorScheme.primary,
        child: InkWell(
          borderRadius: BorderRadius.circular(EsokoRadius.pill),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TableOrderReviewScreen(
                storeSlug: storeSlug,
                tableLabel: tableLabel,
                products: products,
              ),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: EsokoSpacing.s5,
              vertical: EsokoSpacing.s3,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '$count item${count == 1 ? '' : 's'} · Table $tableLabel',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Text(
                      'KES ${total.toStringAsFixed(0)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum _Stage { review, placing, waiting, done, failed }

/// Review the table cart, adjust quantities, send it to the kitchen —
/// one POST /v1/orders carrying every line at once (dbx.CreateStoreOrder
/// already accepted a multi-item array; this is the first mobile screen
/// that actually uses more than one).
class TableOrderReviewScreen extends ConsumerStatefulWidget {
  const TableOrderReviewScreen({
    super.key,
    required this.storeSlug,
    required this.tableLabel,
    required this.products,
  });

  final String storeSlug;
  final String tableLabel;
  final List<ProductSummary> products;

  @override
  ConsumerState<TableOrderReviewScreen> createState() => _TableOrderReviewScreenState();
}

class _TableOrderReviewScreenState extends ConsumerState<TableOrderReviewScreen> {
  final _nameController = TextEditingController();
  final _msisdnController = TextEditingController();
  _Stage _stage = _Stage.review;
  String? _error;
  String? _orderId;
  String? _totalKes;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _nameController.text = auth.profile.displayName;
      _msisdnController.text = auth.profile.msisdn ?? '';
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _nameController.dispose();
    _msisdnController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final cart = ref.read(tableCartProvider);
    if (cart.isEmpty) return;
    if (_nameController.text.trim().isEmpty || _msisdnController.text.trim().isEmpty) {
      setState(() => _error = 'Enter your name and M-Pesa number.');
      return;
    }
    setState(() {
      _stage = _Stage.placing;
      _error = null;
    });
    try {
      final placed = await ref.read(storesRepositoryProvider).placeTableOrder(
            storeSlug: widget.storeSlug,
            tableLabel: widget.tableLabel,
            quantitiesByProductId: cart,
            buyerName: _nameController.text.trim(),
            buyerMsisdn: _msisdnController.text.trim(),
          );
      _orderId = placed.orderId;
      _totalKes = placed.totalKes;
      ref.read(tableCartProvider.notifier).clear();
      if (placed.paid) {
        setState(() => _stage = _Stage.done);
        return;
      }
      setState(() => _stage = _Stage.waiting);
      _startPolling();
    } on ApiException catch (e) {
      setState(() {
        _stage = _Stage.failed;
        _error = e.message;
      });
    }
  }

  void _startPolling() {
    var attempts = 0;
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      if (_orderId == null || attempts > 15) {
        timer.cancel();
        if (mounted && _stage == _Stage.waiting) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'We could not confirm your M-Pesa payment. If you were charged, your order is already with the kitchen — otherwise try again.';
          });
        }
        return;
      }
      try {
        final repo = ref.read(storesRepositoryProvider);
        if (await repo.isOrderPaid(_orderId!)) {
          timer.cancel();
          if (mounted) setState(() => _stage = _Stage.done);
        }
      } on ApiException {
        // transient — keep polling until the attempt cap above
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(tableCartProvider);
    final byId = {for (final p in widget.products) p.id: p};
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: EsokoAppBar(title: 'Table ${widget.tableLabel}'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsokoMotion.medium,
                switchInCurve: EsokoMotion.easeOut,
                switchOutCurve: EsokoMotion.easeOut,
                child: KeyedSubtree(
                  key: ValueKey(_stage),
                  child: switch (_stage) {
                    _Stage.review => _reviewStage(cart, byId),
                    _Stage.placing => const Padding(
                        padding: EdgeInsets.all(EsokoSpacing.s6),
                        child: EsokoSkeletonCard(leading: false),
                      ),
                    _Stage.waiting => EsokoResultView.waiting(
                        title: 'Complete payment on your phone',
                        message: 'Enter your M-Pesa PIN when the prompt arrives.',
                        amountKes: _totalKes,
                      ),
                    _Stage.done => EsokoResultView.success(
                        title: 'Sent to the kitchen',
                        message: 'Table ${widget.tableLabel} — we\'ll bring it over once it\'s ready.',
                        primaryLabel: 'Track this order',
                        onPrimary: () {
                          final id = _orderId;
                          if (id == null) {
                            Navigator.of(context).popUntil((r) => r.isFirst);
                            return;
                          }
                          Navigator.of(context).pushReplacement(
                            MaterialPageRoute(
                              builder: (_) => OrderDetailScreen(orderId: id),
                            ),
                          );
                        },
                      ),
                    _Stage.failed => EsokoResultView.failure(
                        errorMessage: _error ?? 'Something went wrong',
                        primaryLabel: 'Try again',
                        onPrimary: () => setState(() => _stage = _Stage.review),
                      ),
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _reviewStage(Map<String, int> cart, Map<String, ProductSummary> byId) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in cart.entries)
          if (byId[entry.key] case final p?)
            Padding(
              padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        EsokoAmountText(p.priceKes, fontSize: 13),
                      ],
                    ),
                  ),
                  EsokoStepper(
                    value: entry.value,
                    min: 0,
                    onChanged: (v) => ref
                        .read(tableCartProvider.notifier)
                        .setQuantity(entry.key, v),
                  ),
                ],
              ),
            ),
        const SizedBox(height: EsokoSpacing.s3),
        if (_error != null) ...[
          EsokoFormError(message: _error!),
          const SizedBox(height: EsokoSpacing.s3),
        ],
        EsokoPayerFields(
          nameController: _nameController,
          msisdnController: _msisdnController,
          payLabel: 'Send to kitchen · pay with M-Pesa',
          onPay: _send,
        ),
      ],
    );
  }
}
