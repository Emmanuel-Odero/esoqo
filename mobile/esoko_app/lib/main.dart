import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth/auth_controller.dart';
import 'core/auth/auth_state.dart';
import 'core/router.dart';
import 'core/theme/esoko_theme.dart';

void main() {
  runApp(const ProviderScope(child: EsokoApp()));
}

class EsokoApp extends ConsumerWidget {
  const EsokoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Esoko',
      debugShowCheckedModeBanner: false,
      theme: EsokoTheme.light(),
      darkTheme: EsokoTheme.dark(),
      routerConfig: router,
      builder: (context, child) => _SplashGate(child: child),
    );
  }
}

/// Covers the sign-in screen with a plain splash while the stored token
/// is still being checked on cold start (AuthUnknown) — otherwise the
/// sign-in form flashes for a frame before a valid session redirects
/// straight to /home.
class _SplashGate extends ConsumerWidget {
  const _SplashGate({required this.child});
  final Widget? child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is AuthUnknown) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return child ?? const SizedBox.shrink();
  }
}
