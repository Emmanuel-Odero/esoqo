import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';

enum _Step { phone, resetPin }

/// POST /v1/auth/otp (purpose PIN_RESET) then POST /v1/auth/pin/reset —
/// mirrors setSubjectPin's NOT_FOUND contract: this never creates an
/// account, unlike the sign-up-by-OTP flow in otp_sign_in_screen.dart.
class ForgotPinScreen extends ConsumerStatefulWidget {
  const ForgotPinScreen({super.key});

  @override
  ConsumerState<ForgotPinScreen> createState() => _ForgotPinScreenState();
}

class _ForgotPinScreenState extends ConsumerState<ForgotPinScreen> {
  final _msisdnController = TextEditingController();
  final _codeController = TextEditingController();
  final _pinController = TextEditingController();
  _Step _step = _Step.phone;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _msisdnController.dispose();
    _codeController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .requestOtp(
            msisdn: _msisdnController.text.trim(),
            purpose: 'PIN_RESET',
          );
      setState(() => _step = _Step.resetPin);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resetPin() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .resetPin(
            msisdn: _msisdnController.text.trim(),
            code: _codeController.text.trim(),
            pin: _pinController.text.trim(),
          );
      // Router redirect handles navigation to /home from here.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return EsoqoAuthScaffold(
      title: 'Reset your PIN',
      subtitle: 'We\'ll text a code to confirm it\'s you.',
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (_step == _Step.phone) ...[
          EsoqoField.phone(
            controller: _msisdnController,
            onSubmitted: (_) => _requestCode(),
          ),
        ] else ...[
          Text(
            'Enter the code sent to ${_msisdnController.text.trim()} and choose a new PIN.',
          ),
          const SizedBox(height: EsoqoSpacing.s4),
          EsoqoField.otp(controller: _codeController),
          const SizedBox(height: EsoqoSpacing.s3),
          EsoqoField.pin(
            controller: _pinController,
            label: 'New PIN',
            helper: '4 to 6 digits',
            autofill: PinAutofill.create,
            onSubmitted: (_) => _resetPin(),
          ),
        ],
        if (_error != null) EsoqoFormError(message: _error!),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoButton.primary(
          expand: false,
          label: _step == _Step.phone ? 'Send code' : 'Save new PIN',
          loading: _loading,
          onPressed: _step == _Step.phone ? _requestCode : _resetPin,
        ),
      ],
    );
  }
}
