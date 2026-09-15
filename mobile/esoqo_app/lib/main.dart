import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:quick_actions/quick_actions.dart';

import 'core/auth/auth_controller.dart';
import 'core/auth/auth_state.dart';
import 'core/router.dart';
import 'core/theme/esoko_theme.dart';

void main() {
  runApp(const ProviderScope(child: EsokoApp()));
}

class EsokoApp extends ConsumerStatefulWidget {
  const EsokoApp({super.key});

  @override
  ConsumerState<EsokoApp> createState() => _EsokoAppState();
}

class _EsokoAppState extends ConsumerState<EsokoApp> {
  final _quickActions = const QuickActions();

  @override
  void initState() {
    super.initState();
    // App-icon quick actions (long-press Esoko on the home screen):
    // scanner entry points without opening the app first. Signed-out
    // taps fall through the router's auth redirect to sign-in.
    _quickActions.setShortcutItems(const [
      ShortcutItem(
        type: 'scan_bus',
        localizedTitle: 'Scan bus QR',
        icon: 'scan_bus',
      ),
      ShortcutItem(
        type: 'verify_fare',
        localizedTitle: 'Verify fare',
        icon: 'verify_fare',
      ),
    ]);
    _quickActions.initialize((type) {
      final router = ref.read(routerProvider);
      if (type == 'scan_bus') {
        router.go('/scan');
      } else if (type == 'verify_fare') {
        router.go('/verify-fare');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Esoko',
      debugShowCheckedModeBanner: false,
      theme: EsokoTheme.light(),
      darkTheme: EsokoTheme.dark(),
      // Explicit, not left to MaterialApp's own default (which happens
      // to also be .system) — this is the one line that actually wires
      // "follow the phone's appearance setting" together with the two
      // themes above; it deserves to be visible here, not implicit.
      themeMode: ThemeMode.system,
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
