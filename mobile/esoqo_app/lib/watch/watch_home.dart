import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/auth/auth_controller.dart';
import '../core/auth/auth_state.dart';
import '../core/theme/esoqo_tokens.dart';

/// The glanceable home screen once signed in — real identity (from
/// GET /v1/me, same as the phone app's Record tab), honest about having
/// nothing else to show yet: chama balance / next ticket QR / pending
/// withdrawal signature are the actual point of a watch companion, and
/// none of them exist until core-go's Phase 1 domain endpoints ship —
/// see the phone app's ComingSoonScreen for the same principle.
class WatchHome extends ConsumerWidget {
  const WatchHome({super.key, required this.profile});

  final EsoqoProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(EsoqoSpacing.s3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check_circle, color: EsoqoColors.green2, size: 28),
                const SizedBox(height: EsoqoSpacing.s2),
                Text(
                  profile.displayName,
                  style: Theme.of(context).textTheme.titleSmall,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: EsoqoSpacing.s1),
                Text(
                  'Signed in',
                  style: TextStyle(color: EsoqoColors.text3, fontSize: EsoqoTypeScale.micro),
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                TextButton(
                  onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
                  child: const Text('Sign out', style: TextStyle(fontSize: EsoqoTypeScale.micro)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
