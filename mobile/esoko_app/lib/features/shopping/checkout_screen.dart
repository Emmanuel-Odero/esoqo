import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';

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
    super.dispose();
  }

  Future<void> _placeOrder() async {
    setState(() {
      _stage = _Stage.placing;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.post('/v1/orders', {
        'storeSlug': widget.storeSlug,
        'buyerName': _nameController.text.trim(),
        'buyerMsisdn': _msisdnController.text.trim(),
        'paymentMethod': 'MPESA_STK',
        'items': [
          {
            'productId': widget.productId,
            if (widget.variantId != null) 'variantId': widget.variantId,
            'quantity': widget.quantity,
          },
        ],
      });
      _orderId = res['orderId'] as String?;
      _totalKes = res['totalKes'] as String?;
      if (res['status'] == 'PAID') {
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
        return;
      }
      try {
        final api = ref.read(apiClientProvider);
        final res = await api.get('/v1/orders/$_orderId');
        if (res['Status'] == 'PAID') {
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
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: _body(),
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
            Text('${widget.quantity} × ${widget.productLabel}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: EsokoSpacing.s4),
            TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Your name')),
            const SizedBox(height: EsokoSpacing.s3),
            TextField(
              controller: _msisdnController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'M-Pesa phone number', hintText: '+254 7…'),
            ),
            const SizedBox(height: EsokoSpacing.s5),
            FilledButton(onPressed: _placeOrder, child: const Text('Pay with M-Pesa')),
          ],
        );
      case _Stage.placing:
        return const Center(child: CircularProgressIndicator());
      case _Stage.waiting:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: EsokoSpacing.s4),
            const Text('Check your phone and enter your M-Pesa PIN to complete payment.', textAlign: TextAlign.center),
            if (_totalKes != null) ...[
              const SizedBox(height: EsokoSpacing.s2),
              Text('KES $_totalKes', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.bold)),
            ],
          ],
        );
      case _Stage.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, color: EsokoColors.green, size: 56),
            const SizedBox(height: EsokoSpacing.s3),
            Text('Order placed', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: EsokoSpacing.s2),
            const Text('Find it any time in your Profile → History.', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s5),
            FilledButton(
              onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
              child: const Text('Done'),
            ),
          ],
        );
      case _Stage.failed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: EsokoColors.red, size: 48),
            const SizedBox(height: EsokoSpacing.s3),
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s4),
            OutlinedButton(onPressed: () => setState(() => _stage = _Stage.form), child: const Text('Try again')),
          ],
        );
    }
  }
}
