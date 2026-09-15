import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';

/// The PIN you sign in with.
///
/// Its own screen rather than a card three-quarters of the way down a
/// scroll: changing a PIN is rare but consequential, and the one place
/// in the app where somebody arriving deliberately should not have to
/// hunt past a QR code to find it.
class AccountSecurityScreen extends ConsumerStatefulWidget {
  const AccountSecurityScreen({super.key});

  @override
  ConsumerState<AccountSecurityScreen> createState() =>
      _AccountSecurityScreenState();
}

class _AccountSecurityScreenState extends ConsumerState<AccountSecurityScreen> {
  final _pinController = TextEditingController();
  final _pinConfirmController = TextEditingController();
  bool _saving = false;
  String? _error;
  String? _done;

  @override
  void dispose() {
    _pinController.dispose();
    _pinConfirmController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final pin = _pinController.text.trim();
    final confirm = _pinConfirmController.text.trim();
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      setState(() => _error = 'PIN must be 4 to 6 digits');
      return;
    }
    if (pin != confirm) {
      setState(() => _error = 'The two PINs do not match');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _done = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).setPin(pin);
      if (mounted) {
        setState(() {
          _done = 'PIN changed';
          _pinController.clear();
          _pinConfirmController.clear();
        });
      }
    } on ApiException catch (e) {
      // WEAK_PIN and friends arrive here with the server's own copy.
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Security'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s6),
              children: [
                EsoqoSectionHeader(
                  title: 'Change your PIN',
                  subtitle:
                      'The PIN you sign in with. Four to six digits, and never '
                      'one somebody could guess from your phone number.',
                ),
                const SizedBox(height: EsoqoSpacing.s5),
                EsoqoField.pin(
                  controller: _pinController,
                  label: 'New PIN',
                  helper: '4 to 6 digits',
                  autofill: PinAutofill.create,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                // No autofill on the repeat: filling it from the
                // keychain would defeat the point of asking twice.
                EsoqoField.pin(
                  controller: _pinConfirmController,
                  label: 'Repeat new PIN',
                  onSubmitted: (_) => _save(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoFormError(message: _error!),
                ],
                if (_done != null) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoInlineNotice(
                    color: EsoqoColors.green,
                    icon: EsoqoIconName.check,
                    message: _done!,
                  ),
                ],
                const SizedBox(height: EsoqoSpacing.s5),
                EsoqoButton.primary(
                  expand: false,
                  label: 'Change PIN',
                  icon: Icons.lock_outline,
                  loading: _saving,
                  onPressed: _save,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
