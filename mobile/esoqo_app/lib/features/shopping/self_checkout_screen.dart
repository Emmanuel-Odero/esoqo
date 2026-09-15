import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'stores_repository.dart';

/// One line in a self-checkout basket — everything the review screen
/// needs to render without a second fetch, captured off the scan
/// resolution itself.
class SelfCheckoutLine {
  const SelfCheckoutLine({
    required this.name,
    required this.priceKes,
    required this.quantity,
  });

  final String name;
  final String priceKes;
  final int quantity;

  SelfCheckoutLine withQuantity(int q) =>
      SelfCheckoutLine(name: name, priceKes: priceKes, quantity: q);
}

/// A mall/supermarket basket built by scanning shelf barcodes one at a
/// time — see UniversalScanScreen's basket mode. Scoped to a single
/// store slug at once (same as dbx.CreateOrderInput only ever takes
/// one storeId): scanning a product from a different store while a
/// basket is open replaces it, same "one visit, one checkout"
/// assumption dine-in's table cart already makes.
class SelfCheckoutBasketState {
  const SelfCheckoutBasketState({
    this.storeSlug,
    this.storeName,
    this.lines = const {},
  });

  final String? storeSlug;
  final String? storeName;
  final Map<String, SelfCheckoutLine> lines; // productId -> line

  bool get isEmpty => lines.isEmpty;

  int get itemCount => lines.values.fold(0, (sum, l) => sum + l.quantity);

  double get totalKes => lines.values.fold(
    0.0,
    (sum, l) => sum + (double.tryParse(l.priceKes) ?? 0) * l.quantity,
  );
}

class SelfCheckoutBasketController extends Notifier<SelfCheckoutBasketState> {
  @override
  SelfCheckoutBasketState build() => const SelfCheckoutBasketState();

  /// Adds one scanned unit. A scan from a different store than what's
  /// already in the basket starts a fresh basket rather than mixing
  /// two stores' stock into one checkout.
  void addScan({
    required String storeSlug,
    required String storeName,
    required String productId,
    required String name,
    required String priceKes,
  }) {
    final sameStore = state.storeSlug == null || state.storeSlug == storeSlug;
    final lines = sameStore ? {...state.lines} : <String, SelfCheckoutLine>{};
    final existing = lines[productId];
    lines[productId] = (existing ?? SelfCheckoutLine(name: name, priceKes: priceKes, quantity: 0))
        .withQuantity((existing?.quantity ?? 0) + 1);
    state = SelfCheckoutBasketState(
      storeSlug: storeSlug,
      storeName: storeName,
      lines: lines,
    );
  }

  void setQuantity(String productId, int quantity) {
    final lines = {...state.lines};
    if (quantity <= 0) {
      lines.remove(productId);
    } else if (lines[productId] case final l?) {
      lines[productId] = l.withQuantity(quantity);
    }
    state = SelfCheckoutBasketState(
      storeSlug: lines.isEmpty ? null : state.storeSlug,
      storeName: lines.isEmpty ? null : state.storeName,
      lines: lines,
    );
  }

  void clear() => state = const SelfCheckoutBasketState();
}

final selfCheckoutBasketProvider =
    NotifierProvider<SelfCheckoutBasketController, SelfCheckoutBasketState>(
      SelfCheckoutBasketController.new,
    );

/// The floating bar UniversalScanScreen shows once basket mode has
/// picked up at least one item — same shape as TableCartBar.
class SelfCheckoutBasketBar extends ConsumerWidget {
  const SelfCheckoutBasketBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final basket = ref.watch(selfCheckoutBasketProvider);
    if (basket.isEmpty) return const SizedBox.shrink();
    return SafeArea(
      minimum: const EdgeInsets.all(EsoqoSpacing.s4),
      child: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
        color: Theme.of(context).colorScheme.primary,
        child: InkWell(
          borderRadius: BorderRadius.circular(EsoqoRadius.pill),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SelfCheckoutReviewScreen()),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: EsoqoSpacing.s5,
              vertical: EsoqoSpacing.s3,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${basket.itemCount} item${basket.itemCount == 1 ? '' : 's'} · ${basket.storeName ?? 'Basket'}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Text(
                      'KES ${basket.totalKes.toStringAsFixed(0)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
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

/// Review the scanned basket, pay once, walk out — the mall
/// counterpart of TableOrderReviewScreen. The "done" stage shows the
/// exit code inline (fetched off the order once paid) rather than
/// routing into OrderDetailScreen, since a self-checkout order's
/// status shape (no PICKUP fulfilment option, no table) doesn't match
/// either of that screen's two existing layouts.
class SelfCheckoutReviewScreen extends ConsumerStatefulWidget {
  const SelfCheckoutReviewScreen({super.key});

  @override
  ConsumerState<SelfCheckoutReviewScreen> createState() =>
      _SelfCheckoutReviewScreenState();
}

class _SelfCheckoutReviewScreenState
    extends ConsumerState<SelfCheckoutReviewScreen> {
  final _nameController = TextEditingController();
  final _msisdnController = TextEditingController();
  _Stage _stage = _Stage.review;
  String? _error;
  String? _orderId;
  String? _totalKes;
  String? _exitCode;
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

  Future<void> _pay() async {
    final basket = ref.read(selfCheckoutBasketProvider);
    if (basket.isEmpty || basket.storeSlug == null) return;
    if (_nameController.text.trim().isEmpty || _msisdnController.text.trim().isEmpty) {
      setState(() => _error = 'Enter your name and M-Pesa number.');
      return;
    }
    setState(() {
      _stage = _Stage.placing;
      _error = null;
    });
    try {
      final placed = await ref.read(storesRepositoryProvider).placeSelfCheckoutOrder(
            storeSlug: basket.storeSlug!,
            quantitiesByProductId: {
              for (final e in basket.lines.entries) e.key: e.value.quantity,
            },
            buyerName: _nameController.text.trim(),
            buyerMsisdn: _msisdnController.text.trim(),
          );
      _orderId = placed.orderId;
      _totalKes = placed.totalKes;
      ref.read(selfCheckoutBasketProvider.notifier).clear();
      if (placed.paid) {
        await _loadExitCode();
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

  Future<void> _loadExitCode() async {
    final id = _orderId;
    if (id == null) return;
    try {
      final status = await ref.read(storesRepositoryProvider).orderStatus(id);
      if (mounted) setState(() => _exitCode = status.pickupCode);
    } on ApiException {
      // The paid confirmation itself already went through — a missed
      // code fetch just means the buyer taps "View order" instead.
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
            _error = 'We could not confirm your M-Pesa payment. If you were charged, check My Orders — otherwise try again.';
          });
        }
        return;
      }
      try {
        final repo = ref.read(storesRepositoryProvider);
        if (await repo.isOrderPaid(_orderId!)) {
          timer.cancel();
          await _loadExitCode();
          if (mounted) setState(() => _stage = _Stage.done);
        }
      } on ApiException {
        // transient — keep polling until the attempt cap above
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final basket = ref.watch(selfCheckoutBasketProvider);
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Self-checkout'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsoqoMotion.medium,
                switchInCurve: EsoqoMotion.easeOut,
                switchOutCurve: EsoqoMotion.easeOut,
                child: KeyedSubtree(
                  key: ValueKey(_stage),
                  child: switch (_stage) {
                    _Stage.review => _reviewStage(basket),
                    _Stage.placing => const Padding(
                        padding: EdgeInsets.all(EsoqoSpacing.s6),
                        child: EsoqoSkeletonCard(leading: false),
                      ),
                    _Stage.waiting => EsoqoResultView.waiting(
                        title: 'Complete payment on your phone',
                        message: 'Enter your M-Pesa PIN when the prompt arrives.',
                        amountKes: _totalKes,
                      ),
                    _Stage.done => EsoqoResultView.success(
                        title: 'Paid — you\'re free to go',
                        message: _exitCode == null
                            ? 'Show this order at the exit if asked.'
                            : 'Show this code at the exit: $_exitCode',
                        primaryLabel: 'Done',
                        onPrimary: () =>
                            Navigator.of(context).popUntil((r) => r.isFirst),
                      ),
                    _Stage.failed => EsoqoResultView.failure(
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

  Widget _reviewStage(SelfCheckoutBasketState basket) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in basket.lines.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(entry.value.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                      EsoqoAmountText(entry.value.priceKes, fontSize: EsoqoTypeScale.meta),
                    ],
                  ),
                ),
                EsoqoStepper(
                  value: entry.value.quantity,
                  min: 0,
                  onChanged: (v) => ref
                      .read(selfCheckoutBasketProvider.notifier)
                      .setQuantity(entry.key, v),
                ),
              ],
            ),
          ),
        const SizedBox(height: EsoqoSpacing.s3),
        if (_error != null) ...[
          EsoqoFormError(message: _error!),
          const SizedBox(height: EsoqoSpacing.s3),
        ],
        EsoqoPayerFields(
          nameController: _nameController,
          msisdnController: _msisdnController,
          payLabel: 'Pay · KES ${basket.totalKes.toStringAsFixed(0)}',
          onPay: _pay,
        ),
      ],
    );
  }
}

/// The mall guard's whole job: type or scan a code, get one plain
/// green/red answer, next customer. Store-owner-scoped (see
/// dbx.ResolveExitCode's own comment on why there's no separate guard
/// PIN sign-in yet — same fast-follow noted for the table board).
/// Deliberately no product list, no buyer name — a guard needs "did
/// this person pay" and nothing else.
class SelfCheckoutGuardScreen extends ConsumerStatefulWidget {
  const SelfCheckoutGuardScreen({super.key, required this.slug});
  final String slug;

  @override
  ConsumerState<SelfCheckoutGuardScreen> createState() =>
      _SelfCheckoutGuardScreenState();
}

class _SelfCheckoutGuardScreenState
    extends ConsumerState<SelfCheckoutGuardScreen> {
  final _codeController = TextEditingController();
  bool _busy = false;
  ExitCodeResult? _result;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _check(String raw) async {
    final code = raw.trim();
    if (code.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _result = null;
    });
    try {
      final result = await ref.read(storesRepositoryProvider).resolveExitCode(
            storeSlug: widget.slug,
            code: code,
          );
      if (mounted) setState(() => _result = result);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    _codeController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final result = _result;
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Exit check'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (result != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(EsoqoSpacing.s6),
                      decoration: BoxDecoration(
                        color: scheme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(EsoqoRadius.lg),
                        border: Border.all(color: scheme.primary, width: 2),
                      ),
                      child: Column(
                        children: [
                          Icon(
                            Icons.check_circle_rounded,
                            color: scheme.primary,
                            size: 64,
                          ),
                          const SizedBox(height: EsoqoSpacing.s3),
                          Text(
                            result.alreadyExited
                                ? 'Already checked out'
                                : 'Paid — let them through',
                            style: Theme.of(context).textTheme.headlineSmall,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: EsoqoSpacing.s2),
                          Text(
                            '${result.itemCount} item${result.itemCount == 1 ? '' : 's'} · KES ${result.totalKes}',
                          ),
                        ],
                      ),
                    )
                  else if (_error != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(EsoqoSpacing.s6),
                      decoration: BoxDecoration(
                        color: scheme.error.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(EsoqoRadius.lg),
                        border: Border.all(color: scheme.error, width: 2),
                      ),
                      child: Column(
                        children: [
                          Icon(
                            Icons.cancel_rounded,
                            color: scheme.error,
                            size: 64,
                          ),
                          const SizedBox(height: EsoqoSpacing.s3),
                          Text(
                            _error!,
                            style: Theme.of(context).textTheme.headlineSmall,
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: EsoqoSpacing.s6),
                  EsoqoField.code(
                    controller: _codeController,
                    label: 'Exit code',
                    hint: 'PKP-XXXXXX',
                    onSubmitted: _check,
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoButton.primary(
                    expand: false,
                    label: 'Check',
                    loading: _busy,
                    onPressed: () => _check(_codeController.text),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
