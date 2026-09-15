import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';

enum _Step { phone, code, setPin }

/// Sign up or sign in with a one-time code — POST /v1/auth/otp then
/// POST /v1/auth/verify-otp. A correct code auto-provisions a bare
/// Party+Person on first use (see core-go's handleVerifyOtp), so this
/// screen doubles as account creation; a PIN is set afterwards for
/// faster subsequent sign-ins if one isn't already on file.
class OtpSignInScreen extends ConsumerStatefulWidget {
  const OtpSignInScreen({super.key});

  @override
  ConsumerState<OtpSignInScreen> createState() => _OtpSignInScreenState();
}

class _OtpSignInScreenState extends ConsumerState<OtpSignInScreen> {
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
            purpose: 'SIGN_IN',
          );
      setState(() => _step = _Step.code);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final hasPinSet = await ref
          .read(authControllerProvider.notifier)
          .verifyOtpAndSignIn(
            msisdn: _msisdnController.text.trim(),
            code: _codeController.text.trim(),
          );
      if (!hasPinSet) {
        setState(() => _step = _Step.setPin);
      }
      // Otherwise navigation to /home happens via the router's redirect.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _savePin() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .setPin(_pinController.text.trim());
      // Already signed in from _verifyCode — router takes it from here.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return EsoqoAuthScaffold(
      title: 'Sign in with a code',
      subtitle: 'We\'ll text you a one-time code — no PIN needed.',
      onBack: () => Navigator.of(context).pop(),
      children: [
        ..._stepFields(),
        if (_error != null) EsoqoFormError(message: _error!),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoButton.primary(
          expand: false,
          label: _primaryLabel,
          loading: _loading,
          onPressed: _onPrimaryAction,
        ),
      ],
    );
  }

  List<Widget> _stepFields() {
    switch (_step) {
      case _Step.phone:
        // No repeated "enter your phone number" line here — the header
        // subtitle above already says why this screen exists; a second
        // sentence just restating "type your phone number" once you
        // can already see the phone number field would be noise.
        return [
          EsoqoField.phone(
            controller: _msisdnController,
            onSubmitted: (_) => _requestCode(),
          ),
        ];
      case _Step.code:
        return [
          Text('Enter the code sent to ${_msisdnController.text.trim()}.'),
          const SizedBox(height: EsoqoSpacing.s4),
          EsoqoField.otp(
            controller: _codeController,
            onSubmitted: (_) => _verifyCode(),
          ),
        ];
      case _Step.setPin:
        return [
          const Text(
            'You\'re signed in. Set a PIN now for faster sign-in next time.',
          ),
          const SizedBox(height: EsoqoSpacing.s4),
          EsoqoField.pin(
            controller: _pinController,
            label: 'New PIN',
            helper: '4 to 6 digits',
            autofill: PinAutofill.create,
            onSubmitted: (_) => _savePin(),
          ),
        ];
    }
  }

  String get _primaryLabel => switch (_step) {
    _Step.phone => 'Send code',
    _Step.code => 'Verify',
    _Step.setPin => 'Save PIN',
  };

  Future<void> _onPrimaryAction() => switch (_step) {
    _Step.phone => _requestCode(),
    _Step.code => _verifyCode(),
    _Step.setPin => _savePin(),
  };
}
