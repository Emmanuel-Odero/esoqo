import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'api_client.dart';

/// The one [ApiClient] every screen shares — Shopping/Tickets/Profile
/// all read this instead of constructing their own, so a 401 anywhere
/// drops the whole app back to sign-in consistently (not just whichever
/// screen happened to hit it). AuthController itself also uses this
/// instance (see auth_controller.dart) rather than a private one.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(onUnauthorized: () => ref.read(authControllerProvider.notifier).signOutLocally());
});
