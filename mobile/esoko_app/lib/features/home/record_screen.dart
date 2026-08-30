import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';

/// The "Your record" tab — real data from GET /v1/me, same principle as
/// apps/app's /me page: everything shown here is what Esoko actually
/// holds, nothing sample/fabricated.
class RecordScreen extends ConsumerWidget {
  const RecordScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Center(child: CircularProgressIndicator());
    }
    final profile = auth.profile;

    return ListView(
      padding: const EdgeInsets.all(EsokoSpacing.s6),
      children: [
        Text('Your record', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: EsokoSpacing.s2),
        Text(
          'Everything Esoko holds about you — nobody else sees any of it unless you say so.',
          style: TextStyle(color: EsokoColors.text2),
        ),
        const SizedBox(height: EsokoSpacing.s6),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(EsokoSpacing.s5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _row('Name', profile.displayName),
                if (profile.msisdn != null) _row('Phone', profile.msisdn!),
                _row('Esoko ID', profile.partyId, mono: true),
              ],
            ),
          ),
        ),
        const SizedBox(height: EsokoSpacing.s6),
        OutlinedButton(
          onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          child: const Text('Sign out'),
        ),
      ],
    );
  }

  Widget _row(String label, String value, {bool mono = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s2),
      child: Row(
        children: [
          SizedBox(width: 90, child: Text(label, style: TextStyle(color: EsokoColors.text2))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontFamily: mono ? 'monospace' : null),
            ),
          ),
        ],
      ),
    );
  }
}
