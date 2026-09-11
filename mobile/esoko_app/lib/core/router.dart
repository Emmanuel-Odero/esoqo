import 'package:flutter/foundation.dart' show ChangeNotifier;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/forgot_pin_screen.dart';
import '../features/auth/otp_sign_in_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/fleet/crew_shift_screen.dart';
import '../features/fleet/scan_bus_screen.dart';
import '../features/fleet/verify_fare_screen.dart';
import '../features/scan/universal_scan_screen.dart';
import '../features/home/home_shell.dart';
import '../features/home/org_duty_switcher_screen.dart';
import 'auth/auth_controller.dart';
import 'auth/auth_state.dart';

final routerProvider = Provider<GoRouter>((ref) {
  // GoRouter re-evaluates `redirect` whenever this Listenable notifies —
  // wiring it straight to authControllerProvider's changes means
  // sign-in and sign-out immediately reroute, without every screen
  // needing its own listener.
  final notifier = _AuthRefreshNotifier(ref);

  return GoRouter(
    initialLocation: '/sign-in',
    refreshListenable: notifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final path = state.matchedLocation;
      final isAuthRoute = path.startsWith('/sign-in') || path.startsWith('/forgot-pin');

      // Splash stays until the restore resolves, same as before.
      if (auth is AuthUnknown) return null;

      // There used to be a second branch here for an AGENT (crew PIN)
      // session that locked the whole device to /crew-shift — retired
      // (docs/proposals/esoko-unified-crew-identity.md): every crew
      // member is a SUBJECT now, and CREW duty is just another org
      // context they can switch on from inside the app (Profile >
      // Acting as) without losing access to the rest of it. /crew-shift
      // is a normal authenticated route, same as /home.
      if (auth is AuthSignedOut && !isAuthRoute) return '/sign-in';
      if (auth is AuthSignedIn && isAuthRoute) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (context, state) => const SignInScreen()),
      GoRoute(path: '/sign-in/otp', builder: (context, state) => const OtpSignInScreen()),
      GoRoute(path: '/forgot-pin', builder: (context, state) => const ForgotPinScreen()),
      GoRoute(path: '/crew-shift', builder: (context, state) => const CrewShiftScreen()),
      GoRoute(path: '/home', builder: (context, state) => const HomeShell()),
      GoRoute(path: '/org-duty', builder: (context, state) => const OrgDutySwitcherScreen()),
      // Deep targets for the app-icon quick actions (long-press Esoko
      // icon → scan). Auth redirect still applies: signed-out users land
      // on sign-in first. /scan is the universal dispatcher (bus, shelf,
      // table, voucher, receipt); the older single-purpose routes stay
      // for existing entry points.
      GoRoute(path: '/scan', builder: (context, state) => const UniversalScanScreen()),
      GoRoute(path: '/scan-bus', builder: (context, state) => const ScanBusScreen()),
      GoRoute(path: '/verify-fare', builder: (context, state) => const VerifyFareScreen()),
    ],
  );
});

class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(Ref ref) {
    ref.listen(authControllerProvider, (previous, next) => notifyListeners());
  }
}
