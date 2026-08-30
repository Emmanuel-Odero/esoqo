import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoko_tokens.dart';

/// Phone-or-email + PIN — the returning-user path, mirroring
/// apps/app/src/app/signin/actions.ts's actionSignIn (now itself calling
/// core-go, per the same handler this screen calls).
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _identifierController = TextEditingController();
  final _pinController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _identifierController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signIn(
            identifier: _identifierController.text.trim(),
            pin: _pinController.text.trim(),
          );
      // Navigation happens via routerProvider's redirect once
      // authControllerProvider flips to AuthSignedIn.
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
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Sign in', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: EsokoSpacing.s2),
                  const Text('Your Esoko record, groups, shopping and tickets in one place.'),
                  const SizedBox(height: EsokoSpacing.s6),
                  TextField(
                    controller: _identifierController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Phone number or email',
                      hintText: '+254 7… or you@example.com',
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  TextField(
                    controller: _pinController,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(labelText: 'PIN'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s2),
                    Text(_error!, style: TextStyle(color: EsokoColors.red)),
                  ],
                  const SizedBox(height: EsokoSpacing.s4),
                  FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: _loading
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Sign in'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextButton(
                    onPressed: () => context.push('/forgot-pin'),
                    child: const Text('Forgot your PIN?'),
                  ),
                  TextButton(
                    onPressed: () => context.push('/sign-in/otp'),
                    child: const Text('Sign in with a code instead'),
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
