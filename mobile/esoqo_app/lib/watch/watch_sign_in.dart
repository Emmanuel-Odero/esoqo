import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_exception.dart';
import '../core/auth/auth_controller.dart';
import '../core/theme/esoqo_tokens.dart';

enum _Step { phone, code }

/// OTP-only sign-in, sized for a round watch face — no PIN entry (see
/// main_wear.dart's own note on why). Same two core-go calls as the
/// phone app's otp_sign_in_screen: POST /v1/auth/otp then
/// POST /v1/auth/verify-otp.
class WatchSignIn extends ConsumerStatefulWidget {
  const WatchSignIn({super.key});

  @override
  ConsumerState<WatchSignIn> createState() => _WatchSignInState();
}

class _WatchSignInState extends ConsumerState<WatchSignIn> {
  final _msisdnController = TextEditingController();
  final _codeController = TextEditingController();
  _Step _step = _Step.phone;
  bool _loading = false;
  String? _error;

  Future<void> _requestCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .requestOtp(msisdn: _msisdnController.text.trim(), purpose: 'SIGN_IN');
      setState(() => _step = _Step.code);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).verifyOtpAndSignIn(
            msisdn: _msisdnController.text.trim(),
            code: _codeController.text.trim(),
          );
      // AuthController's state flips to AuthSignedIn; main_wear.dart's
      // switch takes it from here. A watch companion doesn't prompt to
      // set a PIN — there's nowhere sane to type one.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(EsoqoSpacing.s3),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'Esoqo',
                style: Theme.of(context).textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: EsoqoSpacing.s3),
              if (_step == _Step.phone)
                TextField(
                  controller: _msisdnController,
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(hintText: '+254 7…'),
                )
              else
                TextField(
                  controller: _codeController,
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  decoration: const InputDecoration(hintText: 'Code'),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: EsoqoSpacing.s2),
                  child: Text(
                    _error!,
                    style: TextStyle(color: EsoqoColors.red, fontSize: EsoqoTypeScale.micro),
                    textAlign: TextAlign.center,
                  ),
                ),
              const SizedBox(height: EsoqoSpacing.s2),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _loading ? null : (_step == _Step.phone ? _requestCode : _verify),
                  child: _loading
                      ? const SizedBox(
                          height: 14, width: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(_step == _Step.phone ? 'Send code' : 'Verify'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
