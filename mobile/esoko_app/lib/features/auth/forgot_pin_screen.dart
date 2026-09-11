import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoko_tokens.dart';
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
    return EsokoAuthScaffold(
      title: 'Reset your PIN',
      subtitle: 'We\'ll text a code to confirm it\'s you.',
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (_step == _Step.phone) ...[
          EsokoFormField(
            controller: _msisdnController,
            label: 'Phone number',
            hint: '+254 7…',
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.telephoneNumber],
            onSubmitted: (_) => _requestCode(),
          ),
        ] else ...[
          Text(
            'Enter the code sent to ${_msisdnController.text.trim()} and choose a new PIN.',
          ),
          const SizedBox(height: EsokoSpacing.s4),
          EsokoFormField(
            controller: _codeController,
            label: '6-digit code',
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.oneTimeCode],
            maxLength: 6,
          ),
          const SizedBox(height: EsokoSpacing.s3),
          EsokoFormField(
            controller: _pinController,
            label: 'New PIN (4–6 digits)',
            obscureText: true,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.newPassword],
            maxLength: 6,
            onSubmitted: (_) => _resetPin(),
          ),
        ],
        if (_error != null) EsokoFormError(message: _error!),
        const SizedBox(height: EsokoSpacing.s4),
        EsokoLoadingButton(
          label: _step == _Step.phone ? 'Send code' : 'Save new PIN',
          loading: _loading,
          onPressed: _step == _Step.phone ? _requestCode : _resetPin,
        ),
      ],
    );
  }
}
