import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

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
      appBar: const EsokoAppBar(title: 'Checkout'),
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
            _orderSummary(),
            const SizedBox(height: EsokoSpacing.s5),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Your name',
                prefixIcon: Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: EsokoSpacing.s3),
            TextField(
              controller: _msisdnController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'M-Pesa phone number',
                hintText: '+254 7…',
                prefixIcon: Icon(Icons.phone_iphone_outlined),
              ),
            ),
            const SizedBox(height: EsokoSpacing.s5),
            FilledButton.icon(
              onPressed: _placeOrder,
              icon: const Icon(Icons.lock_outline, size: 18),
              label: const Text('Pay with M-Pesa'),
            ),
          ],
        );
      case _Stage.placing:
        return const Center(child: CircularProgressIndicator());
      case _Stage.waiting:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            EsokoStatusBadge(
              icon: Icons.phone_android_rounded,
              color: EsokoColors.blue,
              spinning: true,
            ),
            const SizedBox(height: EsokoSpacing.s5),
            Text(
              'Complete payment on your phone',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: EsokoSpacing.s2),
            Text(
              'Enter your M-Pesa PIN when the prompt arrives.',
              style: TextStyle(color: EsokoColors.text2),
              textAlign: TextAlign.center,
            ),
            if (_totalKes != null) ...[
              const SizedBox(height: EsokoSpacing.s4),
              Text(
                'KES $_totalKes',
                style: TextStyle(
                  color: EsokoColors.green,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ],
          ],
        );
      case _Stage.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            EsokoStatusBadge(
              icon: Icons.check_rounded,
              color: EsokoColors.green,
            ),
            const SizedBox(height: EsokoSpacing.s4),
            Text(
              'Order placed',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: EsokoSpacing.s2),
            Text(
              'Find it any time in your Profile → History.',
              textAlign: TextAlign.center,
              style: TextStyle(color: EsokoColors.text2),
            ),
            const SizedBox(height: EsokoSpacing.s6),
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
            EsokoStatusBadge(
              icon: Icons.priority_high_rounded,
              color: EsokoColors.red,
            ),
            const SizedBox(height: EsokoSpacing.s4),
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s5),
            OutlinedButton(
              onPressed: () => setState(() => _stage = _Stage.form),
              child: const Text('Try again'),
            ),
          ],
        );
    }
  }

  Widget _orderSummary() {
    return Container(
      padding: const EdgeInsets.all(EsokoSpacing.s4),
      decoration: BoxDecoration(
        color: EsokoColors.greenTint,
        borderRadius: BorderRadius.circular(EsokoRadius.lg),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: Colors.white,
            child: Text(
              '${widget.quantity}',
              style: TextStyle(
                color: EsokoColors.green,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: EsokoSpacing.s3),
          Expanded(
            child: Text(
              widget.productLabel,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
