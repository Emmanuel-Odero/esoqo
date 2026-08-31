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
      await ref.read(authControllerProvider.notifier).requestOtp(
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
      await ref.read(authControllerProvider.notifier).resetPin(
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
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Reset your PIN'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_step == _Step.phone) ...[
                    const Text('Enter the phone number on your Esoko account.'),
                    const SizedBox(height: EsokoSpacing.s4),
                    TextField(
                      controller: _msisdnController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone number', hintText: '+254 7…'),
                    ),
                  ] else ...[
                    Text('Enter the code sent to ${_msisdnController.text.trim()} and choose a new PIN.'),
                    const SizedBox(height: EsokoSpacing.s4),
                    TextField(
                      controller: _codeController,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: const InputDecoration(labelText: '6-digit code'),
                    ),
                    const SizedBox(height: EsokoSpacing.s3),
                    TextField(
                      controller: _pinController,
                      obscureText: true,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: const InputDecoration(labelText: 'New PIN (4–6 digits)'),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s2),
                    Text(_error!, style: TextStyle(color: EsokoColors.red)),
                  ],
                  const SizedBox(height: EsokoSpacing.s4),
                  FilledButton(
                    onPressed: _loading ? null : (_step == _Step.phone ? _requestCode : _resetPin),
                    child: _loading
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text(_step == _Step.phone ? 'Send code' : 'Save new PIN'),
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
