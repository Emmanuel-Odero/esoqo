import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoqo_tokens.dart';
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
      await ref
          .read(authControllerProvider.notifier)
          .signIn(
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
    return EsoqoAuthScaffold(
      title: 'Sign in',
      subtitle: 'Your Esoqo record, groups, shopping and tickets in one place.',
      children: [
        EsoqoField.identifier(controller: _identifierController),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoField.pin(
          controller: _pinController,
          autofill: PinAutofill.signIn,
          onSubmitted: (_) => _submit(),
        ),
        if (_error != null) EsoqoFormError(message: _error!),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoButton.primary(
          expand: false,
          label: 'Sign in',
          loading: _loading,
          onPressed: _submit,
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoButton.tertiary(
          label: 'Forgot your PIN?',
          onPressed: () => context.push('/forgot-pin'),
        ),
        EsoqoButton.tertiary(
          label: 'Sign in with a code instead',
          onPressed: () => context.push('/sign-in/otp'),
        ),
        // No pre-login "sign in as crew" path any more — every crew
        // member has their own Esoqo account (docs/proposals/
        // esoqo-unified-crew-identity.md); duty for an organisation is
        // switched on from inside the app, via Profile > Acting as,
        // after signing in as yourself. See core/auth/org_context_state.dart.
      ],
    );
  }
}
