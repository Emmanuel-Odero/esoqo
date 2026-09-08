import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/providers.dart';
import '../storage/token_store.dart';

/// An org-scoped crew PIN login — POST /v1/ticket-staff/sign-in with
/// role CREW. Mirrors the shape TicketOrgStaff/apps/store's cashier
/// terminal already use on the web side (org slug + name + PIN, no
/// personal Party account at all), now ported to mobile for the first
/// time — see the tout-shift phase of the journey-map redesign.
class AgentSession {
  const AgentSession({
    required this.orgId,
    required this.role,
    required this.name,
    this.crewMemberId,
  });

  factory AgentSession.fromJson(Map<String, dynamic> json) => AgentSession(
        orgId: json['orgId'] as String,
        role: json['role'] as String,
        name: json['name'] as String,
        crewMemberId: json['crewMemberId'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'orgId': orgId,
        'role': role,
        'name': name,
        'crewMemberId': crewMemberId,
      };

  final String orgId;
  final String role;
  final String name;

  /// Null when a manager hasn't linked this CREW login to a CrewMember
  /// yet — the login can still declare cash (org membership is enough
  /// for that write), but core-go will refuse to let it close a trip
  /// (trip.close:own has nothing to match against). The shift screen
  /// surfaces this as "ask your manager to link your account" rather
  /// than hiding the close action outright, since a stuck-open trip is
  /// worse than a clear message.
  final String? crewMemberId;

  bool get isCrew => role == 'CREW';
}

sealed class AgentState {
  const AgentState();
}

class AgentUnknown extends AgentState {
  const AgentUnknown();
}

class AgentSignedOut extends AgentState {
  const AgentSignedOut();
}

class AgentSignedIn extends AgentState {
  const AgentSignedIn(this.session);
  final AgentSession session;
}

/// Parallel to AuthController, not a variant of it — an agent session
/// has no Party, no /v1/me, no OTP/PIN-reset story of its own. See
/// core/storage/token_store.dart for how the two share one token slot
/// without stepping on each other.
class AgentSessionController extends Notifier<AgentState> {
  late final ApiClient _api;

  @override
  AgentState build() {
    _api = ref.read(apiClientProvider);
    _restore();
    return const AgentUnknown();
  }

  void signOutLocally() {
    state = const AgentSignedOut();
  }

  Future<void> _restore() async {
    if (await TokenStore.instance.readKind() != SessionKind.agent) {
      state = const AgentSignedOut();
      return;
    }
    final raw = await TokenStore.instance.readAgentContext();
    if (raw == null) {
      state = const AgentSignedOut();
      return;
    }
    try {
      state = AgentSignedIn(AgentSession.fromJson(jsonDecode(raw) as Map<String, dynamic>));
    } catch (_) {
      // A corrupt/unreadable blob is as good as no session — drop it
      // rather than get stuck unable to reach either sign-in screen.
      await TokenStore.instance.clear();
      state = const AgentSignedOut();
    }
  }

  /// POST /v1/ticket-staff/sign-in — org slug (public, printed on the
  /// vehicle same as the bus QR would be) + free-text name + PIN.
  /// Wrong org/name/PIN are indistinguishable errors server-side, same
  /// anti-enumeration reasoning as the web org-staff sign-in.
  Future<void> signInAsCrew({
    required String orgSlug,
    required String name,
    required String pin,
  }) async {
    final result = await _api.post('/v1/ticket-staff/sign-in', {
      'orgSlug': orgSlug,
      'name': name,
      'pin': pin,
    });
    final session = AgentSession(
      orgId: result['orgId'] as String,
      role: result['role'] as String,
      name: result['name'] as String,
      crewMemberId: result['crewMemberId'] as String?,
    );
    await TokenStore.instance.writeAgent(result['token'] as String, jsonEncode(session.toJson()));
    state = AgentSignedIn(session);
  }

  Future<void> signOut() async {
    try {
      // Same revoke-by-bearer-token endpoint the subject flow uses —
      // the session service doesn't care which actor type minted it.
      await _api.post('/v1/auth/sign-out');
    } on ApiException {
      // A Redis hiccup must not block leaving crew mode on this device.
    }
    await TokenStore.instance.clear();
    state = const AgentSignedOut();
  }
}

final agentSessionControllerProvider =
    NotifierProvider<AgentSessionController, AgentState>(AgentSessionController.new);
