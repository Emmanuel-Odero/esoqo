import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/agent_session.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

/// Crew's own entry point — org slug + name + PIN, POST
/// /v1/ticket-staff/sign-in with role CREW. A separate, secondary door
/// off the ordinary sign-in screen, not a tab on it: a tout isn't
/// choosing between two ways to use their own account, they're either
/// signing in as themselves or clocking in to a company's terminal.
class CrewSignInScreen extends ConsumerStatefulWidget {
  const CrewSignInScreen({super.key});

  @override
  ConsumerState<CrewSignInScreen> createState() => _CrewSignInScreenState();
}

class _CrewSignInScreenState extends ConsumerState<CrewSignInScreen> {
  final _orgSlugController = TextEditingController();
  final _nameController = TextEditingController();
  final _pinController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _orgSlugController.dispose();
    _nameController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(agentSessionControllerProvider.notifier).signInAsCrew(
            orgSlug: _orgSlugController.text.trim(),
            name: _nameController.text.trim(),
            pin: _pinController.text.trim(),
          );
      // Navigation happens via routerProvider's redirect once
      // agentSessionControllerProvider flips to AgentSignedIn.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Crew sign-in'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const EsokoPageLead(
                    'For drivers and conductors — sign in with your company, your name and the PIN your manager gave you.',
                  ),
                  const SizedBox(height: EsokoSpacing.s6),
                  EsokoFormField(
                    controller: _orgSlugController,
                    label: 'Company code',
                    hint: 'As printed on the vehicle',
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  EsokoFormField(
                    controller: _nameController,
                    label: 'Your name',
                    hint: 'As your manager set it up',
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  EsokoFormField(
                    controller: _pinController,
                    label: 'PIN',
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
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
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('Not crew? Sign in to your own account'),
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
