import 'package:flutter/foundation.dart' show ChangeNotifier;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/forgot_pin_screen.dart';
import '../features/auth/otp_sign_in_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/home/home_shell.dart';
import 'auth/auth_controller.dart';
import 'auth/auth_state.dart';

final routerProvider = Provider<GoRouter>((ref) {
  // GoRouter re-evaluates `redirect` whenever this Listenable notifies —
  // wiring it straight to authControllerProvider's changes means sign-in
  // and sign-out immediately reroute, without every screen needing its
  // own listener.
  final notifier = _AuthRefreshNotifier(ref);

  return GoRouter(
    initialLocation: '/sign-in',
    refreshListenable: notifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final path = state.matchedLocation;
      final isAuthRoute = path.startsWith('/sign-in') || path.startsWith('/forgot-pin');

      if (auth is AuthUnknown) return null; // splash stays until restore() resolves
      if (auth is AuthSignedOut && !isAuthRoute) return '/sign-in';
      if (auth is AuthSignedIn && isAuthRoute) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (context, state) => const SignInScreen()),
      GoRoute(path: '/sign-in/otp', builder: (context, state) => const OtpSignInScreen()),
      GoRoute(path: '/forgot-pin', builder: (context, state) => const ForgotPinScreen()),
      GoRoute(path: '/home', builder: (context, state) => const HomeShell()),
    ],
  );
});

class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(Ref ref) {
    ref.listen(authControllerProvider, (previous, next) => notifyListeners());
  }
}
