import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/agent_session.dart';
import '../auth/auth_controller.dart';
import 'api_client.dart';

/// The one [ApiClient] every screen shares — Shopping/Tickets/Profile
/// all read this instead of constructing their own, so a 401 anywhere
/// drops the whole app back to sign-in consistently (not just whichever
/// screen happened to hit it). AuthController itself also uses this
/// instance (see auth_controller.dart) rather than a private one.
///
/// A 401 clears both the subject and the agent (crew) controller's
/// local state — only one is ever actually signed in at a time (they
/// share one token slot, see core/storage/token_store.dart), so the
/// other's signOutLocally is a harmless no-op. Simpler and safer than
/// asking which kind was active before deciding who to clear.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(onUnauthorized: () {
    ref.read(authControllerProvider.notifier).signOutLocally();
    ref.read(agentSessionControllerProvider.notifier).signOutLocally();
  });
});
