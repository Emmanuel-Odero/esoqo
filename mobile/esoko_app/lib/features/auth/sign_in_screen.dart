import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

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
                  const EsokoBrandLockup(
                    inverse: false,
                    size: 34,
                    mainAxisAlignment: MainAxisAlignment.center,
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  Text('Sign in', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: EsokoSpacing.s2),
                  const Text('Your Esoko record, groups, shopping and tickets in one place.'),
                  const SizedBox(height: EsokoSpacing.s6),
                  EsokoFormField(
                    controller: _identifierController,
                    label: 'Phone number or email',
                    hint: '+254 7… or you@example.com',
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.username],
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  EsokoFormField(
                    controller: _pinController,
                    label: 'PIN',
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.password],
                    maxLength: 6,
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) EsokoFormError(message: _error!),
                  const SizedBox(height: EsokoSpacing.s4),
                  EsokoLoadingButton(
                    label: 'Sign in',
                    loading: _loading,
                    onPressed: _submit,
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
                  TextButton(
                    onPressed: () => context.push('/crew-sign-in'),
                    child: const Text('Driver or conductor? Sign in as crew'),
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
