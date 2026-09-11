import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcels_repository.dart';

enum _Stage { form, paying, waiting, done, failed }

/// The last step of booking a parcel — pay with Esoko points (settles
/// inline) or M-Pesa (STK push, then poll). Same stage-machine shape
/// checkout_screen.dart uses for the identical reason: money moving
/// should cross-fade, never snap.
class ParcelPaymentScreen extends ConsumerStatefulWidget {
  const ParcelPaymentScreen({
    super.key,
    required this.code,
    required this.priceKes,
  });

  final String code;
  final double priceKes;

  @override
  ConsumerState<ParcelPaymentScreen> createState() =>
      _ParcelPaymentScreenState();
}

class _ParcelPaymentScreenState extends ConsumerState<ParcelPaymentScreen> {
  final _msisdnController = TextEditingController();
  String _method = 'ESOKO_POINTS';
  // 'MY' == send the STK prompt to the phone already on file; 'OTHER'
  // == type a different number. Only meaningful when [_myMsisdn] is
  // known — a guest has no "my number" to offer, so they always see
  // the plain phone field instead of this choice.
  String _numberSource = 'MY';
  String? _myMsisdn;
  _Stage _stage = _Stage.form;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _myMsisdn = auth.profile.msisdn;
      _msisdnController.text = _myMsisdn ?? '';
      if (_myMsisdn == null || _myMsisdn!.isEmpty) _numberSource = 'OTHER';
    } else {
      // A guest booking can't spend points it has no account for —
      // default to the only method a guest can actually complete.
      _method = 'MPESA_STK';
      _numberSource = 'OTHER';
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _msisdnController.dispose();
    super.dispose();
  }

  Future<void> _pay() async {
    if (_method == 'MPESA_STK' && _msisdnController.text.trim().isEmpty) {
      setState(() => _error = 'Enter the phone number to send the M-Pesa prompt to.');
      return;
    }
    setState(() {
      _stage = _Stage.paying;
      _error = null;
    });
    try {
      final repo = ref.read(parcelsRepositoryProvider);
      final result = await repo.pay(
        code: widget.code,
        paymentMethod: _method,
        msisdn: _method == 'MPESA_STK' ? _msisdnController.text.trim() : null,
      );
      if (result.status == 'BOOKED') {
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
    // 2s x 30 = 60s — Safaricom's own STK prompt typically stays live
    // that long, so the app shouldn't give up on someone still
    // digging their phone out of a pocket before Safaricom itself
    // would (see the earlier, shorter cap that could report "failed"
    // on a payment that was actually still in flight).
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      if (attempts > 30) {
        timer.cancel();
        if (mounted && _stage == _Stage.waiting) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'We could not confirm your M-Pesa payment. If you were charged, check My parcels — otherwise try again.';
          });
        }
        return;
      }
      try {
        final status = await ref.read(parcelsRepositoryProvider).status(widget.code);
        if (status != null && status.status != 'DRAFT_PENDING_PAYMENT') {
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
      appBar: const EsokoAppBar(title: 'Pay for parcel'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsokoMotion.medium,
                switchInCurve: EsokoMotion.easeOut,
                switchOutCurve: EsokoMotion.easeOut,
                child: KeyedSubtree(key: ValueKey(_stage), child: _body()),
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
        final signedIn = ref.read(authControllerProvider) is AuthSignedIn;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Total', style: Theme.of(context).textTheme.bodySmall),
            EsokoAmountText(widget.priceKes.toStringAsFixed(0), fontSize: 28),
            const SizedBox(height: EsokoSpacing.s4),
            EsokoSegmentedToggle<String>(
              selected: _method,
              onChanged: (m) => setState(() => _method = m),
              options: [
                if (signedIn) ('ESOKO_POINTS', 'Esoko Points'),
                ('MPESA_STK', 'M-Pesa'),
              ],
            ),
            if (_method == 'MPESA_STK') ...[
              const SizedBox(height: EsokoSpacing.s3),
              if (_myMsisdn != null && _myMsisdn!.isNotEmpty) ...[
                // "Other" always ships with its own free-text field
                // right below it — never a choice that silently expects
                // typing somewhere else.
                EsokoSegmentedToggle<String>(
                  selected: _numberSource,
                  onChanged: (v) => setState(() {
                    _numberSource = v;
                    if (v == 'MY') _msisdnController.text = _myMsisdn!;
                  }),
                  options: [
                    ('MY', 'My number'),
                    ('OTHER', 'Another number'),
                  ],
                ),
                const SizedBox(height: EsokoSpacing.s3),
              ],
              if (_numberSource == 'MY' && _myMsisdn != null && _myMsisdn!.isNotEmpty)
                EsokoListTile(
                  title: 'STK prompt goes to',
                  subtitle: _myMsisdn,
                  icon: Icons.phone_iphone_outlined,
                )
              else
                EsokoFormField(
                  controller: _msisdnController,
                  label: 'M-Pesa phone number',
                  hint: 'e.g. 0712345678',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                ),
            ],
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              EsokoFormError(message: _error!),
            ],
            const SizedBox(height: EsokoSpacing.s4),
            EsokoLoadingButton(
              label: _method == 'ESOKO_POINTS' ? 'Pay with points' : 'Pay with M-Pesa',
              onPressed: _pay,
            ),
          ],
        );
      case _Stage.paying:
        return const Padding(
          padding: EdgeInsets.all(EsokoSpacing.s6),
          child: EsokoSkeletonCard(leading: false),
        );
      case _Stage.waiting:
        return EsokoResultView.waiting(
          title: 'Complete payment on your phone',
          message: 'Enter your M-Pesa PIN when the prompt arrives.',
          amountKes: widget.priceKes.toStringAsFixed(0),
        );
      case _Stage.done:
        return EsokoResultView.success(
          title: 'Parcel booked',
          message: "We'll text you the moment it's picked up.",
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).pop(widget.code),
        );
      case _Stage.failed:
        return EsokoResultView.failure(
          errorMessage: _error ?? 'Something went wrong',
          primaryLabel: 'Try again',
          onPrimary: () => setState(() => _stage = _Stage.form),
        );
    }
  }
}
