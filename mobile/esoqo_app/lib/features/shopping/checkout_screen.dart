import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'stores_repository.dart';

enum _Stage { form, placing, waiting, done, failed }

/// POST /v1/orders → M-Pesa STK push → poll GET /v1/orders/:id until the
/// webhook (or, in console/dev mode, the immediate auto-confirm — see
/// core-go's handleCreateOrder) flips it to PAID. Single-product
/// checkout — see product_detail_screen.dart's own note on why there's
/// no multi-item cart in v1.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({
    super.key,
    required this.storeSlug,
    required this.productId,
    required this.quantity,
    required this.productLabel,
    this.variantId,
  });

  final String storeSlug;
  final String productId;
  final String? variantId;
  final int quantity;
  final String productLabel;

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _nameController = TextEditingController();
  final _msisdnController = TextEditingController();
  final _voucherCodeController = TextEditingController();
  String _method = 'MPESA_STK';
  _Stage _stage = _Stage.form;
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
    _voucherCodeController.dispose();
    super.dispose();
  }

  Future<void> _placeOrder() async {
    setState(() {
      _stage = _Stage.placing;
      _error = null;
    });
    try {
      final repo = ref.read(storesRepositoryProvider);
      String? voucherId;
      if (_method == 'VOUCHER') {
        voucherId = await repo.resolveVoucherCode(_voucherCodeController.text);
        if (voucherId == null) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'Voucher not found — check the code.';
          });
          return;
        }
      }
      final placed = await repo.placeOrder(
        storeSlug: widget.storeSlug,
        productId: widget.productId,
        variantId: widget.variantId,
        quantity: widget.quantity,
        buyerName: _nameController.text.trim(),
        buyerMsisdn: _msisdnController.text.trim(),
        paymentMethod: _method,
        voucherId: voucherId,
      );
      _orderId = placed.orderId;
      _totalKes = placed.totalKes;
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
        // Don't strand the user on an indefinite spinner — surface a
        // recoverable failure with retry.
        if (mounted && _stage == _Stage.waiting) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'We could not confirm your M-Pesa payment. If you were charged, it will appear in History — otherwise try again.';
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
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Checkout'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s6),
              // The stage machine cross-fades (form → skeleton →
              // waiting → result) instead of snapping — money moving
              // should never visually jump.
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsoqoMotion.medium,
                switchInCurve: EsoqoMotion.easeOut,
                switchOutCurve: EsoqoMotion.easeOut,
                child: KeyedSubtree(
                  key: ValueKey(_stage),
                  child: _body(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_stage) {
      case _Stage.form:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _orderSummary(),
            const SizedBox(height: EsoqoSpacing.s4),
            EsoqoSegmentedToggle<String>(
              selected: _method,
              onChanged: (m) => setState(() => _method = m),
              options: const [
                ('MPESA_STK', 'M-Pesa'),
                ('VOUCHER', 'Voucher'),
              ],
            ),
            if (_method == 'VOUCHER') ...[
              const SizedBox(height: EsoqoSpacing.s3),
              EsoqoField.code(
                controller: _voucherCodeController,
                label: 'Voucher code',
                hint: 'e.g. VCH-XXXXXX',
              ),
            ],
            const SizedBox(height: EsoqoSpacing.s4),
            EsoqoPayerFields(
              nameController: _nameController,
              msisdnController: _msisdnController,
              payLabel: _method == 'VOUCHER' ? 'Pay with voucher' : 'Pay with M-Pesa',
              onPay: _placeOrder,
            ),
          ],
        );
      case _Stage.placing:
        return const Padding(
          padding: EdgeInsets.all(EsoqoSpacing.s6),
          child: EsoqoSkeletonCard(leading: false),
        );
      case _Stage.waiting:
        return EsoqoResultView.waiting(
          title: 'Complete payment on your phone',
          message: 'Enter your M-Pesa PIN when the prompt arrives.',
          amountKes: _totalKes,
        );
      case _Stage.done:
        return EsoqoResultView.success(
          title: 'Order placed',
          message: 'Find it any time in Settings → History.',
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).popUntil((r) => r.isFirst),
        );
      case _Stage.failed:
        return EsoqoResultView.failure(
          errorMessage: _error ?? 'Something went wrong',
          primaryLabel: 'Try again',
          onPrimary: () => setState(() => _stage = _Stage.form),
        );
    }
  }

  Widget _orderSummary() {
    final scheme = Theme.of(context).colorScheme;
    return EsoqoListTile(
      title: widget.productLabel,
      leading: CircleAvatar(
        radius: 20,
        backgroundColor: scheme.surface,
        child: Text(
          '${widget.quantity}',
          style: TextStyle(
            color: scheme.primary,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
